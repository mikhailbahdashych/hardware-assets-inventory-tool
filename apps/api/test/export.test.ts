import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

describe('the export-all endpoint', () => {
  it('is admin-only', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    for (const role of ['manager', 'viewer'] as const) {
      const res = await inject(ctx.app, {
        method: 'GET',
        url: '/api/v1/export',
        cookie: await memberCookie(ctx.db, role),
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('sends a downloadable JSON file carrying the whole workspace', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const maya = (
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/employees',
        cookie: admin,
        body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io' },
      })
    ).json().employee;
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: {
        name: 'MacBook Pro 14"',
        category: 'laptops',
        status: 'assigned',
        assignedToEmployeeId: maya.id,
        checkoutDate: '2026-01-09',
      },
    });

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/export', cookie: admin });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="inventory-export-/);

    const body = res.json();
    expect(body.formatVersion).toBe(1);
    expect(body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.settings).toMatchObject({ orgName: 'Acme Corp', assetTagPrefix: 'AST' });
    expect(body.employees).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({ name: 'MacBook Pro 14"', status: 'assigned' });
    expect(body.assignments[0]).toMatchObject({ holderNameSnapshot: 'Maya Lindqvist' });
    expect(body.customFieldDefs.length).toBeGreaterThan(0);
    expect(body.auditEvents.length).toBeGreaterThan(0);
  });

  /**
   * A file that says who had access without saying what that access allowed
   * describes half the workspace. The grants come along for the same reason
   * the custom-field definitions do: they are what the other rows mean.
   */
  it('describes the roles as well as who held them', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/export', cookie: admin })
    ).json();

    expect(body.roles.map((role: { id: string }) => role.id)).toEqual([
      'admin',
      'manager',
      'viewer',
    ]);
    expect(body.roles[0]).toMatchObject({ label: 'Admin', isSystem: true });
    // Manager's nine, and nothing for the system role — its set is resolved.
    expect(body.rolePermissions).toHaveLength(9);
    expect(body.rolePermissions.every((grant: { roleId: string }) => grant.roleId === 'manager')).toBe(true); // prettier-ignore
  });

  /**
   * The bytes are not in the file, so the checksum is what makes the metadata
   * worth having: a restored `uploads/` directory can be checked against it.
   */
  it('lists each attachment with the checksum of its bytes', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = (
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/assets',
        cookie: admin,
        body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
      })
    ).json().asset;

    const boundary = '----inventory-export-boundary';
    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${asset.id}/attachments`,
      cookie: admin,
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="invoice.pdf"\r\n` +
            'Content-Type: application/pdf\r\n\r\n',
        ),
        Buffer.from('%PDF-1.7 fake invoice'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/export', cookie: admin })
    ).json();
    expect(body.attachments[0]).toMatchObject({
      filename: 'invoice.pdf',
      sizeBytes: 21,
      sha256: createHash('sha256').update('%PDF-1.7 fake invoice').digest('hex'),
    });
    // Still metadata only: the bytes live in DATA_DIR/uploads.
    expect(body.attachments[0].storedName).toBeUndefined();
  });

  it('carries no password hashes and no session or token rows', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/export', cookie: admin });

    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('$argon2');
    const body = res.json();
    expect(body.sessions).toBeUndefined();
    expect(body.authTokens).toBeUndefined();
    // Members are listed so the file describes who had access, minus secrets.
    expect(body.members[0]).toMatchObject({ email: 'tomasz@acme.io', role: 'admin' });
  });
});
