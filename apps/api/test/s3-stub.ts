import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

/** One object in the stub bucket. */
export interface StubObject {
  body: Buffer;
  contentType: string | undefined;
  lastModified: Date;
}

export interface StubS3Options {
  /** How many keys one listing may answer with. 1000 is what S3 does. */
  pageSize?: number;
}

export interface S3Stub {
  /** What `makeStorage` takes: only the network is missing. */
  client: S3Client;
  /** The bucket, readable and writable by the test. */
  objects: Map<string, StubObject>;
  /** Every command the driver sent, in order — the assertion surface. */
  sent: object[];
}

/**
 * An S3 that answers from memory. The driver under test builds real command
 * objects and reads real response shapes; what the stub replaces is the HTTP
 * call, which is exactly the seam `makeStorage(config, s3?)` exists for.
 *
 * It is deliberately strict about the shapes it accepts — a Buffer body, a
 * prefix on every listing — because those are the driver's contract, and a stub
 * that shrugs at a broken one proves nothing.
 */
export function stubS3(options: StubS3Options = {}): S3Stub {
  const pageSize = options.pageSize ?? 1000;
  const objects = new Map<string, StubObject>();
  const sent: object[] = [];

  const send = async (command: object): Promise<unknown> => {
    sent.push(command);

    if (command instanceof PutObjectCommand) {
      const { Key, Body, ContentType } = command.input;
      if (!Buffer.isBuffer(Body)) throw new Error('PutObject wants a Buffer from this driver.');
      objects.set(Key!, { body: Body, contentType: ContentType, lastModified: new Date() });
      return {};
    }

    if (command instanceof GetObjectCommand) {
      const object = objects.get(command.input.Key!);
      if (!object) {
        // What S3 answers, and what the driver has to recognise.
        const error = new Error('The specified key does not exist.');
        error.name = 'NoSuchKey';
        throw error;
      }
      return { Body: Readable.from([object.body]) };
    }

    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key!);
      // S3 answers a delete of a key that was never there the same way.
      return {};
    }

    if (command instanceof ListObjectsV2Command) {
      const { Prefix, ContinuationToken } = command.input;
      if (Prefix === undefined) throw new Error('This driver must list under a prefix.');
      const keys = [...objects.keys()].filter((key) => key.startsWith(Prefix)).sort();
      // The stub's token is the key to resume at — real ones are opaque, and
      // nothing but the stub may read it.
      const start = ContinuationToken === undefined ? 0 : keys.indexOf(ContinuationToken);
      const page = keys.slice(start, start + pageSize);
      const next = keys[start + pageSize];
      return {
        Contents: page.map((key) => ({ Key: key, LastModified: objects.get(key)!.lastModified })),
        IsTruncated: next !== undefined,
        NextContinuationToken: next,
      };
    }

    throw new Error(`The stub S3 was sent a ${command.constructor.name} it has no answer for.`);
  };

  return {
    // The one cast: an S3Client is a class with a middleware stack and a
    // config, and `send` is the whole of it the driver ever touches.
    client: { send } as unknown as S3Client,
    objects,
    sent,
  };
}

/** The commands of one kind the driver sent, for asserting on their inputs. */
export function sentOf<T extends object>(stub: S3Stub, kind: new (...args: never[]) => T): T[] {
  return stub.sent.filter((command): command is T => command instanceof kind);
}
