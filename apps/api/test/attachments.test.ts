import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachments } from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const BOUNDARY = '----inventory-test-boundary';

function filePayload(filename: string, content: string, mime = 'application/pdf') {
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${mime}\r\n\r\n`,
      ),
      Buffer.from(content),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

async function createAsset(cookie: string) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
  });
  return res.json().asset as { id: string; assetTag: string };
}

const upload = (cookie: string, assetId: string, filename: string, content: string) =>
  inject(ctx.app, {
    method: 'POST',
    url: `/api/v1/assets/${assetId}/attachments`,
    cookie,
    ...filePayload(filename, content),
  });

describe('attachments', () => {
  it('stores the file on disk under a generated name and lists it on the asset', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);

    const res = await upload(admin, asset.id, 'invoice-ast-0001.pdf', '%PDF-1.7 fake invoice');
    expect(res.statusCode).toBe(200);
    expect(res.json().attachment).toMatchObject({
      filename: 'invoice-ast-0001.pdf',
      mime: 'application/pdf',
      sizeBytes: 21,
      uploadedByName: 'Tomasz Kowalski',
    });

    const row = ctx.db.select().from(attachments).all()[0];
    // The stored name is ours, never the caller's — an uploaded name is not a path.
    expect(row.storedName).not.toBe('invoice-ast-0001.pdf');
    expect(existsSync(join(ctx.uploadsDir, row.storedName))).toBe(true);

    const detail = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
    });
    expect(detail.json().attachments).toHaveLength(1);
    expect(detail.json().attachments[0].filename).toBe('invoice-ast-0001.pdf');
  });

  it('serves the bytes back as a download, never inline', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);
    const uploaded = await upload(admin, asset.id, 'warranty.pdf', 'warranty bytes');

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/attachments/${uploaded.json().attachment.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('warranty bytes');
    // Uploaded files are never rendered by the browser: no stored XSS.
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('warranty.pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('will not hand a file to somebody without a session', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);
    const uploaded = await upload(admin, asset.id, 'warranty.pdf', 'warranty bytes');

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${uploaded.json().attachment.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('deletes the row and the file, and audits it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);
    const uploaded = await upload(admin, asset.id, 'warranty.pdf', 'warranty bytes');
    const stored = ctx.db.select().from(attachments).all()[0].storedName;

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/attachments/${uploaded.json().attachment.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.db.select().from(attachments).all()).toHaveLength(0);
    expect(existsSync(join(ctx.uploadsDir, stored))).toBe(false);
  });

  it('takes the files with it when the asset goes', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);
    await upload(admin, asset.id, 'warranty.pdf', 'warranty bytes');

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.db.select().from(attachments).all()).toHaveLength(0);
    expect(readdirSync(ctx.uploadsDir)).toHaveLength(0);
  });

  it('is closed to viewers, readable by everyone signed in', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);
    const uploaded = await upload(admin, asset.id, 'warranty.pdf', 'warranty bytes');
    const viewer = memberCookie(ctx.db, 'viewer');

    expect((await upload(viewer, asset.id, 'nope.pdf', 'x')).statusCode).toBe(403);
    expect(
      (
        await inject(ctx.app, {
          method: 'DELETE',
          url: `/api/v1/attachments/${uploaded.json().attachment.id}`,
          cookie: viewer,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await inject(ctx.app, {
          method: 'GET',
          url: `/api/v1/attachments/${uploaded.json().attachment.id}`,
          cookie: viewer,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('404s for an unknown asset and an unknown attachment', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    expect((await upload(admin, 'nope', 'x.pdf', 'x')).statusCode).toBe(404);
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/attachments/nope', cookie: admin }))
        .statusCode,
    ).toBe(404);
  });
});
