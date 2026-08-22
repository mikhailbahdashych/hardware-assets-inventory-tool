import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@/config.js';
import { attachments } from '@/db/schema.js';
import { makeStorage, ObjectNotStored } from '@/services/storage.js';
import { runMaintenance } from '@/services/jobs.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';
import { sentOf, stubS3 } from './s3-stub.js';

let ctx: TestApp;
const scratchDirs: string[] = [];

afterEach(async () => {
  await ctx?.close();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A data directory of this test's own, for the driver that writes to one. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-storage-'));
  scratchDirs.push(dir);
  return dir;
}

const BUCKET = 'inventory-files';
const MONDAY = new Date('2026-08-17T09:00:00Z');
const hoursBefore = (hours: number) => new Date(MONDAY.getTime() - hours * 3_600_000);

describe('makeStorage', () => {
  it('writes to the volume when no bucket is named, even holding a client', async () => {
    const dataDir = scratch();
    const stub = stubS3();
    const storage = makeStorage(loadConfig({ DATA_DIR: dataDir }), stub.client);

    await storage.put('a1b2.pdf', Buffer.from('invoice bytes'), 'application/pdf');

    expect(await readFile(join(dataDir, 'uploads', 'a1b2.pdf'), 'utf8')).toBe('invoice bytes');
    // A client to hand is not a reason to use it: the bucket is the whole choice.
    expect(stub.sent).toEqual([]);
  });

  it('writes to the bucket as soon as one is named', async () => {
    const dataDir = scratch();
    const stub = stubS3();
    const storage = makeStorage(loadConfig({ DATA_DIR: dataDir, S3_BUCKET: BUCKET }), stub.client);

    await storage.put('a1b2.pdf', Buffer.from('invoice bytes'), 'application/pdf');

    expect([...stub.objects.keys()]).toEqual(['uploads/a1b2.pdf']);
    expect(existsSync(join(dataDir, 'uploads'))).toBe(false);
  });
});

describe('the local driver', () => {
  const local = (dataDir: string) => makeStorage(loadConfig({ DATA_DIR: dataDir }));

  it('makes the uploads directory on the way past, and reads the bytes back', async () => {
    const dataDir = scratch();
    const storage = local(dataDir);

    await storage.put('a1b2.pdf', Buffer.from('invoice bytes'), 'application/pdf');

    expect(await text(await storage.stream('a1b2.pdf'))).toBe('invoice bytes');
  });

  it('says an object is not stored rather than handing back a broken stream', async () => {
    const storage = local(scratch());
    await expect(storage.stream('gone.pdf')).rejects.toBeInstanceOf(ObjectNotStored);
  });

  it('removes what is there and shrugs at what is not', async () => {
    const dataDir = scratch();
    const storage = local(dataDir);
    await storage.put('a1b2.pdf', Buffer.from('bytes'), 'application/pdf');

    await storage.remove('a1b2.pdf');
    await storage.remove('a1b2.pdf');

    expect(existsSync(join(dataDir, 'uploads', 'a1b2.pdf'))).toBe(false);
  });

  it('lists what is on the volume with its mtime, and nothing at all before there is a directory', async () => {
    const dataDir = scratch();
    const storage = local(dataDir);
    expect(await storage.list()).toEqual([]);

    mkdirSync(join(dataDir, 'uploads'), { recursive: true });
    writeFileSync(join(dataDir, 'uploads', 'a1b2.pdf'), 'bytes');
    utimesSync(join(dataDir, 'uploads', 'a1b2.pdf'), hoursBefore(72), hoursBefore(72));
    // A directory somebody dropped in there is not a stored object.
    mkdirSync(join(dataDir, 'uploads', 'nested'));

    expect(await storage.list()).toEqual([{ name: 'a1b2.pdf', lastModified: hoursBefore(72) }]);
  });
});

describe('the S3 driver', () => {
  const s3 = (stub: ReturnType<typeof stubS3>) =>
    makeStorage(loadConfig({ DATA_DIR: '/nowhere', S3_BUCKET: BUCKET }), stub.client);

  it('puts the bytes under the uploads prefix, with the type the browser sent', async () => {
    const stub = stubS3();

    await s3(stub).put('a1b2.pdf', Buffer.from('invoice bytes'), 'application/pdf');

    const [put] = sentOf(stub, PutObjectCommand);
    expect(put!.input).toMatchObject({
      Bucket: BUCKET,
      Key: 'uploads/a1b2.pdf',
      ContentType: 'application/pdf',
    });
    expect(stub.objects.get('uploads/a1b2.pdf')!.body.toString()).toBe('invoice bytes');
  });

  it('streams an object back by the same key', async () => {
    const stub = stubS3();
    const storage = s3(stub);
    await storage.put('a1b2.pdf', Buffer.from('invoice bytes'), 'application/pdf');

    expect(await text(await storage.stream('a1b2.pdf'))).toBe('invoice bytes');
    expect(sentOf(stub, GetObjectCommand)[0]!.input).toMatchObject({
      Bucket: BUCKET,
      Key: 'uploads/a1b2.pdf',
    });
  });

  it('says an object is not stored when the bucket has no such key', async () => {
    await expect(s3(stubS3()).stream('gone.pdf')).rejects.toBeInstanceOf(ObjectNotStored);
  });

  it('deletes by key, and a second delete is no more than a request', async () => {
    const stub = stubS3();
    const storage = s3(stub);
    await storage.put('a1b2.pdf', Buffer.from('bytes'), 'application/pdf');

    await storage.remove('a1b2.pdf');
    await storage.remove('a1b2.pdf');

    expect(stub.objects.size).toBe(0);
    expect(sentOf(stub, DeleteObjectCommand).map((command) => command.input.Key)).toEqual([
      'uploads/a1b2.pdf',
      'uploads/a1b2.pdf',
    ]);
  });

  it('lists every key, not the first page of them', async () => {
    const stub = stubS3({ pageSize: 1000 });
    const storage = s3(stub);
    for (let index = 0; index < 2500; index += 1) {
      stub.objects.set(`uploads/file-${String(index).padStart(4, '0')}.pdf`, {
        body: Buffer.from('bytes'),
        contentType: 'application/pdf',
        lastModified: hoursBefore(72),
      });
    }

    const listed = await storage.list();

    // A sweep that stopped at 1000 would leave every later orphan on the bill,
    // and no test that only ever wrote a handful of objects would notice.
    expect(listed).toHaveLength(2500);
    expect(listed[0]).toEqual({ name: 'file-0000.pdf', lastModified: hoursBefore(72) });
    expect(listed.at(-1)!.name).toBe('file-2499.pdf');
    const listings = sentOf(stub, ListObjectsV2Command);
    expect(listings).toHaveLength(3);
    expect(listings[0]!.input).toMatchObject({ Bucket: BUCKET, Prefix: 'uploads/' });
    expect(listings[1]!.input.ContinuationToken).toBe('uploads/file-1000.pdf');
  });
});

describe('an instance whose attachments live in a bucket', () => {
  const BOUNDARY = '----inventory-test-boundary';

  function upload(cookie: string, assetId: string, filename: string, content: string) {
    return inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${assetId}/attachments`,
      cookie,
      payload: Buffer.concat([
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: application/pdf\r\n\r\n`,
        ),
        Buffer.from(content),
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    });
  }

  async function withBucket(stub: ReturnType<typeof stubS3>) {
    ctx = await buildTestApp({ S3_BUCKET: BUCKET }, () => MONDAY, undefined, stub.client);
    const admin = await setupOrg(ctx.app);
    const asset = (
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/assets',
        cookie: admin,
        body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
      })
    ).json().asset as { id: string };
    return { admin, asset };
  }

  it('takes an upload into the bucket and hands it back as a download', async () => {
    const stub = stubS3();
    const { admin, asset } = await withBucket(stub);

    const uploaded = await upload(admin, asset.id, 'invoice.pdf', '%PDF-1.7 fake invoice');
    expect(uploaded.statusCode).toBe(200);

    const row = (await ctx.db.select().from(attachments))[0]!;
    expect([...stub.objects.keys()]).toEqual([`uploads/${row.storedName}`]);
    expect(stub.objects.get(`uploads/${row.storedName}`)!.contentType).toBe('application/pdf');
    // Nothing was written to the volume on the way through.
    expect(existsSync(ctx.uploadsDir)).toBe(false);

    const download = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/attachments/${row.id}`,
      cookie: admin,
    });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('%PDF-1.7 fake invoice');
    // The bytes come through the app, under a session — never a presigned URL.
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');

    const removed = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/attachments/${row.id}`,
      cookie: admin,
    });
    expect(removed.statusCode).toBe(204);
    expect(stub.objects.size).toBe(0);
  });

  it('404s a row whose object is not in the bucket, with an envelope the client can read', async () => {
    const stub = stubS3();
    const { admin, asset } = await withBucket(stub);
    await upload(admin, asset.id, 'invoice.pdf', 'bytes');
    const row = (await ctx.db.select().from(attachments))[0]!;
    stub.objects.clear();

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/attachments/${row.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('sweeps the old keys nothing references, and leaves the rest', async () => {
    const stub = stubS3();
    const { admin, asset } = await withBucket(stub);
    await upload(admin, asset.id, 'invoice.pdf', 'bytes');
    const kept = (await ctx.db.select().from(attachments))[0]!.storedName;
    // As old as the stray one: being referenced is what saves it.
    stub.objects.get(`uploads/${kept}`)!.lastModified = hoursBefore(72);
    const stray = (name: string, ageHours: number) =>
      stub.objects.set(`uploads/${name}`, {
        body: Buffer.from('stray bytes'),
        contentType: undefined,
        lastModified: hoursBefore(ageHours),
      });
    stray('abandoned.pdf', 72);
    stray('in-flight.pdf', 2);

    const result = await runMaintenance(ctx.deps, MONDAY);

    expect(result.orphanUploadsRemoved).toBe(1);
    // A set, because the stored name is a uuid and nothing about this depends
    // on where it happens to sort.
    expect(new Set(stub.objects.keys())).toEqual(
      new Set([`uploads/${kept}`, 'uploads/in-flight.pdf']),
    );
  });

  it('empties the bucket when the workspace is deleted', async () => {
    const stub = stubS3();
    const { admin, asset } = await withBucket(stub);
    await upload(admin, asset.id, 'invoice.pdf', 'bytes');
    expect(stub.objects.size).toBe(1);

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/workspace/delete',
      cookie: admin,
      body: { confirmText: 'Acme Corp' },
    });

    expect(res.statusCode).toBe(204);
    expect(stub.objects.size).toBe(0);
  });
});
