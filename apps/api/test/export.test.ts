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
        cookie: memberCookie(ctx.db, role),
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
