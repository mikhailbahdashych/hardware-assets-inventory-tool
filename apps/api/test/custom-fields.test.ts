import { afterEach, describe, expect, it } from 'vitest';
import { assetCustomValues, auditEvents, customFieldDefs } from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const list = (cookie: string) =>
  inject(ctx.app, { method: 'GET', url: '/api/v1/custom-fields', cookie });

const create = (cookie: string, body: Record<string, unknown>) =>
  inject(ctx.app, { method: 'POST', url: '/api/v1/custom-fields', cookie, body });

describe('custom field definitions', () => {
  it('ships the four the design shows, in order', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await list(admin);
    expect(res.json().customFields.map((f: { key: string }) => f.key)).toEqual([
      'mdm_enrolled',
      'disk_encryption',
      'hostname',
      'cost_center',
    ]);
  });

  it('derives a stable key from the label, since the key is the CSV column', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await create(admin, { label: 'Warranty provider', type: 'text' });
    expect(res.statusCode).toBe(200);
    expect(res.json().customField).toMatchObject({
      key: 'warranty_provider',
      label: 'Warranty provider',
      type: 'text',
    });

    const event = (await ctx.db.select().from(auditEvents)).find(
      (e) => e.action === 'custom_field.created',
    );
    expect(event).toMatchObject({ type: 'system' });
  });

  it('refuses a label whose key is taken', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const clash = await create(admin, { label: 'MDM enrolled', type: 'boolean' });
    expect(clash.statusCode).toBe(422);
    expect(clash.json().error.fields).toMatchObject({ label: expect.any(String) });
  });

  it('refuses a label that leaves no key behind', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    expect((await create(admin, { label: '///', type: 'text' })).statusCode).toBe(422);
  });

  it('renames a field without disturbing the values stored under its key', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: {
        name: 'MacBook Pro 14"',
        category: 'laptops',
        status: 'available',
        customValues: { hostname: 'maya-mbp' },
      },
    });
    const assetId = asset.json().asset.id;
    const field = (await ctx.db.select().from(customFieldDefs)).find((f) => f.key === 'hostname')!;

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/custom-fields/${field.id}`,
      cookie: admin,
      body: { label: 'Device hostname' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().customField).toMatchObject({ key: 'hostname', label: 'Device hostname' });

    const detail = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${assetId}`,
      cookie: admin,
    });
    expect(
      detail.json().customFields.find((f: { key: string }) => f.key === 'hostname'),
    ).toMatchObject({ label: 'Device hostname', value: 'maya-mbp' });
  });

  it('takes its stored values with it when deleted', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: {
        name: 'MacBook Pro 14"',
        category: 'laptops',
        status: 'available',
        customValues: { hostname: 'maya-mbp' },
      },
    });
    const field = (await ctx.db.select().from(customFieldDefs)).find((f) => f.key === 'hostname')!;

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/custom-fields/${field.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);
    expect(await ctx.db.select().from(assetCustomValues)).toHaveLength(0);
    expect(await ctx.db.select().from(customFieldDefs)).toHaveLength(3);
  });

  it('is readable by everyone but editable only by admins', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const viewer = await memberCookie(ctx.db, 'viewer');
    const manager = await memberCookie(ctx.db, 'manager');

    expect((await list(viewer)).statusCode).toBe(200);
    expect((await create(viewer, { label: 'Nope', type: 'text' })).statusCode).toBe(403);
    expect((await create(manager, { label: 'Nope', type: 'text' })).statusCode).toBe(403);
  });
});
