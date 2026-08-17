import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assets,
  assetCustomValues,
  assetStatusTransitions,
  assignments,
  auditEvents,
  orgSettings,
} from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const LAPTOP = { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' };

async function createAsset(cookie: string, body: Record<string, unknown> = {}) {
  return inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { ...LAPTOP, ...body },
  });
}

async function createEmployee(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: {
      firstName: 'Maya',
      lastName: 'Lindqvist',
      email: `maya.${Math.random().toString(36).slice(2, 8)}@acme.io`,
      ...overrides,
    },
  });
  if (res.statusCode !== 200) throw new Error(`employee create failed: ${res.body}`);
  return res.json().employee as { id: string; displayName: string };
}

describe('asset list', () => {
  it('needs a session', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('is readable by a viewer and reports the current holder', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    await createAsset(admin, { name: 'Dell U2723QE', category: 'monitors' });
    await createAsset(admin, {
      status: 'assigned',
      assignedToEmployeeId: employee.id,
      checkoutDate: '2026-01-09',
    });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/assets',
      cookie: memberCookie(ctx.db, 'viewer'),
    });
    expect(res.statusCode).toBe(200);

    const list = res.json().assets as { name: string; currentHolder: { name: string } | null }[];
    expect(list).toHaveLength(2);
    expect(list.find((a) => a.name === 'Dell U2723QE')!.currentHolder).toBeNull();
    expect(list.find((a) => a.name === LAPTOP.name)!.currentHolder).toMatchObject({
      employeeId: employee.id,
      name: 'Maya Lindqvist',
    });
  });
});

describe('creating an asset', () => {
  it('generates the next tag from the organization prefix', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const first = await createAsset(admin);
    expect(first.statusCode).toBe(200);
    expect(first.json().asset.assetTag).toBe('AST-0001');

    const second = await createAsset(admin, { name: 'ThinkPad X1' });
    expect(second.json().asset.assetTag).toBe('AST-0002');

    const suggestion = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/assets/next-tag',
      cookie: admin,
    });
    expect(suggestion.json()).toEqual({ assetTag: 'AST-0003' });
  });

  it('follows a changed tag prefix', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    ctx.db.update(orgSettings).set({ assetTagPrefix: 'HW' }).run();

    const created = await createAsset(admin);
    expect(created.json().asset.assetTag).toBe('HW-0001');
  });

  it('keeps an explicit tag and refuses a duplicate with a field error', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const created = await createAsset(admin, { assetTag: 'AST-0142' });
    expect(created.json().asset.assetTag).toBe('AST-0142');

    const clash = await createAsset(admin, { name: 'Other', assetTag: 'AST-0142' });
    expect(clash.statusCode).toBe(422);
    expect(clash.json().error.fields).toMatchObject({ assetTag: expect.any(String) });
  });

  it('stores money as cents, dates as date-only, and audits the creation', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await createAsset(admin, {
      purchaseDate: '2024-03-12',
      purchasePriceCents: 234000,
      currency: 'EUR',
      warrantyUntil: '2027-03-12',
      serialNumber: 'C02XK1AZQ6L7',
    });
    expect(res.json().asset).toMatchObject({
      purchaseDate: '2024-03-12',
      purchasePriceCents: 234000,
      currency: 'EUR',
    });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'asset.created');
    expect(event).toMatchObject({ type: 'assets', actorName: 'Tomasz Kowalski' });
    expect(JSON.parse(event!.params)).toMatchObject({
      assetName: LAPTOP.name,
      assetTag: 'AST-0001',
    });
  });

  it('opens the first ownership record when created as assigned', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);

    const res = await createAsset(admin, {
      status: 'assigned',
      assignedToEmployeeId: employee.id,
      checkoutDate: '2026-01-09',
    });
    expect(res.statusCode).toBe(200);

    const open = ctx.db.select().from(assignments).all();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      employeeId: employee.id,
      holderNameSnapshot: 'Maya Lindqvist',
      checkedOutAt: '2026-01-09',
      returnedAt: null,
    });
    expect(res.json().asset.status).toBe('assigned');
  });

  it('refuses to be assigned to nobody, or to somebody who does not exist', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const noHolder = await createAsset(admin, { status: 'assigned' });
    expect(noHolder.statusCode).toBe(422);

    const ghost = await createAsset(admin, {
      status: 'assigned',
      assignedToEmployeeId: 'nobody',
      checkoutDate: '2026-01-09',
    });
    expect(ghost.statusCode).toBe(422);
    expect(ghost.json().error.fields).toMatchObject({ assignedToEmployeeId: expect.any(String) });
    expect(ctx.db.select().from(assets).all()).toHaveLength(0);
  });

  it('stores custom field values against their definitions', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const created = await createAsset(admin, {
      customValues: { mdm_enrolled: 'true', hostname: 'maya-mbp' },
    });
    const detail = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${created.json().asset.id}`,
      cookie: admin,
    });
    const fields = detail.json().customFields as { key: string; value: string | null }[];
    expect(fields.find((f) => f.key === 'mdm_enrolled')).toMatchObject({
      value: 'true',
      label: 'MDM enrolled',
      type: 'boolean',
    });
    expect(fields.find((f) => f.key === 'hostname')!.value).toBe('maya-mbp');
    expect(fields.find((f) => f.key === 'cost_center')!.value).toBeNull();
  });

  it('is closed to viewers', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await createAsset(memberCookie(ctx.db, 'viewer'));
    expect(res.statusCode).toBe(403);
  });

  it('is open to managers', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await createAsset(memberCookie(ctx.db, 'manager'));
    expect(res.statusCode).toBe(200);
  });
});

describe('editing an asset', () => {
  it('records exactly which fields changed', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin, { supplier: 'Insight EMEA' })).json().asset.id;

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
      body: { name: 'MacBook Pro 16"', supplier: null, notes: 'Keyboard replaced' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().asset).toMatchObject({ name: 'MacBook Pro 16"', supplier: null });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'asset.updated');
    expect(JSON.parse(event!.params).changedFields.sort()).toEqual(['name', 'notes', 'supplier']);
  });

  it('writes no audit event when nothing actually changed', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin)).json().asset.id;

    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
      body: { name: LAPTOP.name },
    });
    expect(
      ctx.db
        .select()
        .from(auditEvents)
        .all()
        .filter((e) => e.action === 'asset.updated'),
    ).toHaveLength(0);
  });

  it('audits a status move separately and rejects the ones assign/check-in own', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const spare = (await createAsset(admin)).json().asset.id;
    const held = (
      await createAsset(admin, {
        name: 'ThinkPad X1',
        status: 'assigned',
        assignedToEmployeeId: employee.id,
        checkoutDate: '2026-01-09',
      })
    ).json().asset.id;

    const repair = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${spare}`,
      cookie: admin,
      body: { status: 'in_repair' },
    });
    expect(repair.statusCode).toBe(200);
    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'asset.status_changed');
    expect(JSON.parse(event!.params)).toMatchObject({ from: 'available', to: 'in_repair' });

    const intoAssigned = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${spare}`,
      cookie: admin,
      body: { status: 'assigned' },
    });
    expect(intoAssigned.statusCode).toBe(409);
    expect(intoAssigned.json().error.code).toBe('status_locked');

    const outOfAssigned = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${held}`,
      cookie: admin,
      body: { status: 'available' },
    });
    expect(outOfAssigned.statusCode).toBe(409);
  });

  it('lets the workflow graph, not the code, decide a direct move', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin)).json().asset.id;
    const move = (status: string) =>
      inject(ctx.app, { method: 'PATCH', url: `/api/v1/assets/${id}`, cookie: admin, body: { status } }); // prettier-ignore

    // The seeded mesh connects everything, so this is the behaviour that shipped.
    expect((await move('retired')).statusCode).toBe(200);
    expect((await move('available')).statusCode).toBe(200);

    ctx.db
      .delete(assetStatusTransitions)
      .where(
        and(
          eq(assetStatusTransitions.fromStatus, 'available'),
          eq(assetStatusTransitions.toStatus, 'retired'),
        ),
      )
      .run();

    const refused = await move('retired');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('transition_not_allowed');
    expect(refused.json().error.message).toBe('The workflow does not allow Available → Retired.');
    // The move that is still on the graph is still allowed.
    expect((await move('in_repair')).statusCode).toBe(200);
  });

  it('refuses a status this workspace has never heard of', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin)).json().asset.id;

    const created = await createAsset(admin, { name: 'Ghost', status: 'teleported' });
    expect(created.statusCode).toBe(422);
    expect(created.json().error.fields).toMatchObject({ status: expect.any(String) });

    const patched = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
      body: { status: 'teleported' },
    });
    expect(patched.statusCode).toBe(422);
    expect(patched.json().error.fields).toMatchObject({ status: expect.any(String) });
  });

  it('replaces custom values and clears the ones set to null', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin, { customValues: { hostname: 'maya-mbp' } })).json().asset
      .id;

    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
      body: { customValues: { hostname: null, cost_center: 'CC-42' } },
    });

    const detail = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
    });
    const fields = detail.json().customFields as { key: string; value: string | null }[];
    expect(fields.find((f) => f.key === 'hostname')!.value).toBeNull();
    expect(fields.find((f) => f.key === 'cost_center')!.value).toBe('CC-42');
  });

  it('404s for an unknown asset and 403s for a viewer', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin)).json().asset.id;

    const missing = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/assets/nope',
      cookie: admin,
      body: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);

    const viewer = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie: memberCookie(ctx.db, 'viewer'),
      body: { name: 'x' },
    });
    expect(viewer.statusCode).toBe(403);
  });
});

describe('deleting an asset', () => {
  it('is admin-only and takes the custom values with it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createAsset(admin, { customValues: { hostname: 'maya-mbp' } })).json().asset
      .id;

    const manager = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${id}`,
      cookie: memberCookie(ctx.db, 'manager'),
    });
    expect(manager.statusCode).toBe(403);

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.db.select().from(assets).where(eq(assets.id, id)).all()).toHaveLength(0);
    expect(ctx.db.select().from(assetCustomValues).all()).toHaveLength(0);
    expect(
      ctx.db
        .select()
        .from(auditEvents)
        .all()
        .some((e) => e.action === 'asset.deleted'),
    ).toBe(true);
  });

  it('refuses while somebody is holding it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const id = (
      await createAsset(admin, {
        status: 'assigned',
        assignedToEmployeeId: employee.id,
        checkoutDate: '2026-01-09',
      })
    ).json().asset.id;

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('asset_assigned');
  });
});
