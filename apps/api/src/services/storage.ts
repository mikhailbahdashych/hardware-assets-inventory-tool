import { type FileHandle, mkdir, open, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { Config } from '@/types/config.js';
import type { AttachmentStorage, StoredObject } from '@/types/storage.js';

// Where an attachment's bytes go, behind one interface with two drivers. The
// services above it never learn which one they got — the same shape of seam as
// `db/`, and chosen the same way: by an environment variable naming a resource.

/**
 * Nothing is stored under that name. Both drivers raise it for the one case a
 * caller has an answer to — a row whose bytes are missing is a 404, not a 500 —
 * and let every other failure through as itself.
 */
export class ObjectNotStored extends Error {
  constructor(storedName: string) {
    super(`Nothing is stored under the name ${storedName}.`);
    this.name = 'ObjectNotStored';
  }
}

/** Files live beside the database on the one volume a self-host has to back up. */
export const uploadsDir = (config: Config): string => join(config.dataDir, 'uploads');

/**
 * Keys sit under one prefix so the bucket may hold other things — Terraform's
 * state, a backup, whatever the operator already keeps there.
 */
const KEY_PREFIX = 'uploads/';

/**
 * Naming a bucket is the whole choice, the way `DATABASE_URL` is the whole
 * engine choice: there is no mode and no second code path above this function.
 *
 * `s3` is the test seam. Injecting one without naming a bucket changes nothing —
 * an instance with no `S3_BUCKET` writes to its volume, whatever it is holding.
 */
export function makeStorage(config: Config, s3?: S3Client): AttachmentStorage {
  const bucket = config.s3Bucket;
  if (bucket === undefined) return localDriver(uploadsDir(config));
  // Not a fallback: the parameter is the seam tests reach for, and a client
  // built from the config is what the option means when nobody injects one.
  return s3Driver(bucket, s3 ?? createS3Client(config));
}

/**
 * Credentials come from the AWS default chain — the EC2 instance role in the
 * full-scale deployment — so there are no key variables here to end up in an
 * env file. A region for AWS, an endpoint and path-style addressing for the
 * MinIO-compatible stores that have neither regions nor virtual-host names.
 */
function createS3Client(config: Config): S3Client {
  return new S3Client({
    ...(config.s3Region === undefined ? {} : { region: config.s3Region }),
    ...(config.s3Endpoint === undefined ? {} : { endpoint: config.s3Endpoint }),
    ...(config.s3ForcePathStyle ? { forcePathStyle: true } : {}),
  });
}

/** The default, and what every demo and production-light instance runs. */
function localDriver(directory: string): AttachmentStorage {
  const pathOf = (storedName: string) => join(directory, storedName);

  return {
    put: async (storedName, data) => {
      await mkdir(directory, { recursive: true });
      await writeFile(pathOf(storedName), data);
    },

    stream: async (storedName) => {
      // Opening is the check. `createReadStream` on a missing path fails
      // asynchronously, by which time the response has its headers — and a
      // caller that stats first is answering about a different moment.
      let handle: FileHandle;
      try {
        handle = await open(pathOf(storedName), 'r');
      } catch (error) {
        if (isEnoent(error)) throw new ObjectNotStored(storedName);
        throw error;
      }
      return handle.createReadStream();
    },

    remove: async (storedName) => {
      try {
        await unlink(pathOf(storedName));
      } catch (error) {
        // Already gone is the outcome asked for. Anything else is real.
        if (!isEnoent(error)) throw error;
      }
    },

    list: async () => {
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        // An instance where nobody has uploaded anything has no directory yet.
        if (isEnoent(error)) return [];
        throw error;
      }

      const objects: StoredObject[] = [];
      for (const name of names) {
        const info = await stat(pathOf(name)).catch(() => null);
        // A file that vanished between the listing and the stat is already
        // gone, and a directory in there was never a stored object.
        if (info === null || !info.isFile()) continue;
        objects.push({ name, lastModified: new Date(info.mtimeMs) });
      }
      return objects;
    },
  };
}

/** The full-scale one: an S3 bucket, or anything that speaks its API. */
function s3Driver(bucket: string, client: S3Client): AttachmentStorage {
  const keyOf = (storedName: string) => `${KEY_PREFIX}${storedName}`;

  return {
    put: async (storedName, data, mime) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keyOf(storedName),
          Body: data,
          ContentType: mime,
        }),
      );
    },

    stream: async (storedName) => {
      let body;
      try {
        ({ Body: body } = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: keyOf(storedName) }),
        ));
      } catch (error) {
        if (isMissingObject(error)) throw new ObjectNotStored(storedName);
        throw error;
      }
      // The SDK types `Body` for every runtime it supports; on Node it is a
      // Readable, and anything else here is a build this code has never run in.
      if (!(body instanceof Readable)) {
        throw new Error(`S3 answered ${keyOf(storedName)} with a body that is not a stream.`);
      }
      return body;
    },

    remove: async (storedName) => {
      // DeleteObject is already idempotent: a key that was never there answers
      // exactly as one that was.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyOf(storedName) }));
    },

    list: async () => {
      const objects: StoredObject[] = [];
      let token: string | undefined;
      // A listing answers at most 1000 keys. Stopping at the first page would
      // leave every later orphan on the bill of a workspace big enough to have
      // them — and nothing smaller would ever notice.
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: KEY_PREFIX,
            ContinuationToken: token,
          }),
        );
        // A page with no keys carries no `Contents` at all — absent by design.
        for (const entry of page.Contents ?? []) {
          const { Key, LastModified } = entry;
          // The prefix can exist as a zero-byte object of its own if somebody
          // made a "folder" in the console, and an object the listing cannot
          // date is not one to decide the age of. Neither is an attachment.
          if (Key === undefined || LastModified === undefined) continue;
          if (!Key.startsWith(KEY_PREFIX)) continue;
          const name = Key.slice(KEY_PREFIX.length);
          if (name === '') continue;
          objects.push({ name, lastModified: LastModified });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return objects;
    },
  };
}

/** The one errno either driver has an answer for: nothing is there. */
function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * The same question of a bucket. A real store raises a typed exception carrying
 * the status; the name is what an S3-compatible one that raises something
 * plainer still says, and it is what the tests' stub throws.
 */
function isMissingObject(error: unknown): boolean {
  if (error instanceof S3ServiceException) return error.$metadata.httpStatusCode === 404;
  return error instanceof Error && error.name === 'NoSuchKey';
}
