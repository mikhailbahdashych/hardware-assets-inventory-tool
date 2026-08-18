import { eq, isNull } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, assetStatuses, assignments, auditEvents } from '@/db/schema.js';
import type { Db } from '@/types/db.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

async function createEmployee(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: {
      firstName: 'Maya',
      lastName: 'Lindqvist',
      email: `maya.${Math.random().toString(36).slice(2, 10)}@acme.io`,
      ...overrides,
    },
  });
  if (res.statusCode !== 200) throw new Error(`employee create failed: ${res.body}`);
  return res.json().employee as { id: string; displayName: string };
}

async function createAsset(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available', ...overrides },
  });
  if (res.statusCode !== 200) throw new Error(`asset create failed: ${res.body}`);
  return res.json().asset as { id: string; assetTag: string; status: string };
}

const assign = (cookie: string, assetId: string, body: Record<string, unknown>) =>
  inject(ctx.app, { method: 'POST', url: `/api/v1/assets/${assetId}/assign`, cookie, body });

const checkin = (cookie: string, assetId: string, body: Record<string, unknown>) =>
  inject(ctx.app, { method: 'POST', url: `/api/v1/assets/${assetId}/checkin`, cookie, body });

/**
 * The invariant this whole PR exists to protect: an asset reads `assigned` if
 * and only if it has an open ownership record, and never has two.
 */
function expectInvariant(db: Db): void {
  const open = db.select().from(assignments).where(isNull(assignments.returnedAt)).all();
  const held = new Set(open.map((row) => row.assetId));
  expect(held.size).toBe(open.length);

  for (const asset of db.select().from(assets).all()) {
    expect({ tag: asset.assetTag, assigned: asset.status === 'assigned' }).toEqual({
      tag: asset.assetTag,
      assigned: held.has(asset.id),
    });
  }
}

describe('assigning an asset', () => {
  it('opens an ownership record, moves the asset, and audits it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const asset = await createAsset(admin);

    const res = await assign(admin, asset.id, {
      employeeId: employee.id,
      checkoutDate: '2026-03-14',
      expectedReturnDate: '2026-09-14',
      notes: 'includes charger',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().asset).toMatchObject({
      status: 'assigned',
      currentHolder: {
        employeeId: employee.id,
        name: 'Maya Lindqvist',
        checkedOutAt: '2026-03-14',
      },
    });

    const open = ctx.db.select().from(assignments).all();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      holderNameSnapshot: 'Maya Lindqvist',
      expectedReturnDate: '2026-09-14',
      checkoutNotes: 'includes charger',
      returnedAt: null,
      outcome: null,
    });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'asset.assigned');
    expect(event).toMatchObject({ type: 'assets', assetId: asset.id, employeeId: employee.id });
    expect(JSON.parse(event!.params)).toMatchObject({ holderName: 'Maya Lindqvist' });
    expectInvariant(ctx.db);
  });

  it('accepts an ordered asset — kit is often assigned before it lands', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const asset = await createAsset(admin, { status: 'ordered' });

    const res = await assign(admin, asset.id, {
      employeeId: employee.id,
      checkoutDate: '2026-03-14',
    });
    expect(res.statusCode).toBe(200);
    expectInvariant(ctx.db);
  });

  it('refuses an asset that is not free', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const first = await createEmployee(admin);
    const second = await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor' });
    const asset = await createAsset(admin, { status: 'in_repair' });

    const repairing = await assign(admin, asset.id, {
      employeeId: first.id,
      checkoutDate: '2026-03-14',
    });
    expect(repairing.statusCode).toBe(409);
    expect(repairing.json().error.code).toBe('asset_unavailable');
    // The message names the workspace's own assignable statuses, so an admin
    // who renamed them reads their own words back.
    expect(repairing.json().error.message).toBe(
      'Only an asset that is Available or Ordered can be handed out.',
    );

    const free = await createAsset(admin, { name: 'ThinkPad X1' });
    await assign(admin, free.id, { employeeId: first.id, checkoutDate: '2026-03-14' });
    const twice = await assign(admin, free.id, {
      employeeId: second.id,
      checkoutDate: '2026-03-15',
    });
    expect(twice.statusCode).toBe(409);
    expectInvariant(ctx.db);
  });

  it('refuses a holder who is unknown or on their way out', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const leaver = await createEmployee(admin);
    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${leaver.id}`,
      cookie: admin,
      body: { status: 'offboarding' },
    });
    const asset = await createAsset(admin);

    const ghost = await assign(admin, asset.id, {
      employeeId: 'nobody',
      checkoutDate: '2026-03-14',
    });
    expect(ghost.statusCode).toBe(422);
    expect(ghost.json().error.fields).toMatchObject({ employeeId: expect.any(String) });

    const offboarding = await assign(admin, asset.id, {
      employeeId: leaver.id,
      checkoutDate: '2026-03-14',
    });
    expect(offboarding.statusCode).toBe(422);
    expectInvariant(ctx.db);
  });

  it('is closed to viewers', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const asset = await createAsset(admin);

    const res = await assign(memberCookie(ctx.db, 'viewer'), asset.id, {
      employeeId: employee.id,
      checkoutDate: '2026-03-14',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('checking an asset in', () => {
  async function held(overrides: Record<string, unknown> = {}) {
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin, overrides);
    const asset = await createAsset(admin);
    await assign(admin, asset.id, { employeeId: employee.id, checkoutDate: '2026-03-14' });
    return { admin, employee, asset };
  }

  it('closes the record, lands the asset, and derives the outcome', async () => {
    ctx = await buildTestApp();
    const { admin, asset } = await held();

    const res = await checkin(admin, asset.id, {
      returnDate: '2026-08-16',
      newStatus: 'available',
      condition: 'good',
      notes: 'charger missing',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().asset).toMatchObject({ status: 'available', currentHolder: null });

    const record = ctx.db.select().from(assignments).all()[0];
    expect(record).toMatchObject({
      returnedAt: '2026-08-16',
      checkinCondition: 'good',
      checkinNewStatus: 'available',
      checkinNotes: 'charger missing',
      outcome: 'returned',
    });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'asset.checked_in');
    // The label at write time, not the slug: renaming or deleting a status
    // afterwards must not rewrite what the log already said.
    expect(JSON.parse(event!.params)).toMatchObject({
      holderName: 'Maya Lindqvist',
      outcome: 'returned',
      to: 'Available',
    });
    expectInvariant(ctx.db);
  });

  it('only offers the statuses the workflow marks as check-in destinations', async () => {
    ctx = await buildTestApp();
    const { admin, asset } = await held();

    // Ordered is a real status, but nothing comes back from a person into it.
    const ordered = await checkin(admin, asset.id, {
      returnDate: '2026-08-16',
      newStatus: 'ordered',
    });
    expect(ordered.statusCode).toBe(422);
    expect(ordered.json().error.fields).toMatchObject({ newStatus: expect.any(String) });

    const nowhere = await checkin(admin, asset.id, {
      returnDate: '2026-08-16',
      newStatus: 'teleported',
    });
    expect(nowhere.statusCode).toBe(422);

    // Turning the flag off takes the destination away, live.
    ctx.db
      .update(assetStatuses)
      .set({ checkinTarget: false })
      .where(eq(assetStatuses.id, 'in_repair'))
      .run();
    const repair = await checkin(admin, asset.id, {
      returnDate: '2026-08-16',
      newStatus: 'in_repair',
    });
    expect(repair.statusCode).toBe(422);

    expect(ctx.db.select().from(assets).all()[0]!.status).toBe('assigned');
    expectInvariant(ctx.db);
  });

  it('follows the assignable flag rather than a hard-coded pair', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const asset = await createAsset(admin, { status: 'in_repair' });

    ctx.db
      .update(assetStatuses)
      .set({ assignableFrom: true })
      .where(eq(assetStatuses.id, 'in_repair'))
      .run();

    const res = await assign(admin, asset.id, {
      employeeId: employee.id,
      checkoutDate: '2026-03-14',
    });
    expect(res.statusCode).toBe(200);
    expectInvariant(ctx.db);
  });

  it('lands in repair when that is where it goes', async () => {
    ctx = await buildTestApp();
    const { admin, asset } = await held();

    const res = await checkin(admin, asset.id, {
      returnDate: '2026-08-16',
      newStatus: 'in_repair',
      condition: 'damaged',
    });
    expect(res.json().asset.status).toBe('in_repair');
    expect(ctx.db.select().from(assignments).all()[0]!.outcome).toBe('in_repair');
    expectInvariant(ctx.db);
  });

  it('records an offboarding return as offboarded', async () => {
    ctx = await buildTestApp();
    const { admin, employee, asset } = await held();
    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${employee.id}`,
      cookie: admin,
      body: { status: 'offboarding' },
    });

    await checkin(admin, asset.id, { returnDate: '2026-08-16', newStatus: 'available' });
    expect(ctx.db.select().from(assignments).all()[0]!.outcome).toBe('offboarded');
  });

  it('refuses an asset nobody is holding', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);

    const res = await checkin(admin, asset.id, {
      returnDate: '2026-08-16',
      newStatus: 'available',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('asset_not_assigned');
  });

  it('refuses a return that predates the checkout', async () => {
    ctx = await buildTestApp();
    const { admin, asset } = await held();

    const res = await checkin(admin, asset.id, {
      returnDate: '2026-01-01',
      newStatus: 'available',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields).toMatchObject({ returnDate: expect.any(String) });
    expectInvariant(ctx.db);
  });

  it('frees the asset to be assigned again, keeping both records', async () => {
    ctx = await buildTestApp();
    const { admin, asset } = await held();
    const next = await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor' });

    await checkin(admin, asset.id, { returnDate: '2026-08-16', newStatus: 'available' });
    const again = await assign(admin, asset.id, {
      employeeId: next.id,
      checkoutDate: '2026-08-20',
    });
    expect(again.statusCode).toBe(200);
    expect(ctx.db.select().from(assignments).all()).toHaveLength(2);
    expectInvariant(ctx.db);
  });
});

/**
 * Deterministic pseudo-randomness: a failing seed reproduces exactly, which a
 * property test is worthless without.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the status ⇔ ownership invariant', () => {
  it.each([1, 7, 42, 1337])('survives a random sequence of operations (seed %i)', async (seed) => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const random = mulberry32(seed);
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;

    const people = [
      await createEmployee(admin, { firstName: 'Maya', lastName: 'Lindqvist' }),
      await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor' }),
      await createEmployee(admin, { firstName: 'Sofia', lastName: 'Reyes' }),
    ];
    const assetIds = [
      (await createAsset(admin, { name: 'A' })).id,
      (await createAsset(admin, { name: 'B', status: 'ordered' })).id,
      (await createAsset(admin, { name: 'C', status: 'in_repair' })).id,
    ];

    const dates = ['2026-01-05', '2026-03-14', '2026-06-01', '2026-08-16', '2026-11-30'];
    const statuses = ['available', 'in_repair', 'ordered', 'retired', 'lost_stolen'];

    for (let step = 0; step < 60; step += 1) {
      const assetId = pick(assetIds);
      const action = pick(['assign', 'checkin', 'status', 'offboard', 'delete', 'create']);

      if (action === 'assign') {
        await assign(admin, assetId, { employeeId: pick(people).id, checkoutDate: pick(dates) });
      } else if (action === 'checkin') {
        await checkin(admin, assetId, {
          returnDate: pick(dates),
          newStatus: pick(['available', 'in_repair', 'retired']),
        });
      } else if (action === 'status') {
        await inject(ctx.app, {
          method: 'PATCH',
          url: `/api/v1/assets/${assetId}`,
          cookie: admin,
          body: { status: pick(statuses) },
        });
      } else if (action === 'offboard') {
        await inject(ctx.app, {
          method: 'PATCH',
          url: `/api/v1/employees/${pick(people).id}`,
          cookie: admin,
          body: { status: pick(['active', 'offboarding']) },
        });
      } else if (action === 'delete') {
        const res = await inject(ctx.app, {
          method: 'DELETE',
          url: `/api/v1/assets/${assetId}`,
          cookie: admin,
        });
        if (res.statusCode === 204) {
          assetIds.splice(assetIds.indexOf(assetId), 1);
          assetIds.push((await createAsset(admin, { name: `R${step}` })).id);
        }
      } else {
        const created = await createAsset(admin, {
          name: `N${step}`,
          status: random() < 0.5 ? 'available' : 'assigned',
          assignedToEmployeeId: pick(people).id,
          checkoutDate: pick(dates),
        });
        assetIds.push(created.id);
      }

      // Checked after every single step: a violation names the step that caused it.
      expectInvariant(ctx.db);
    }
  });

  it('cannot be broken by two assignments racing for the same asset', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const first = await createEmployee(admin, { firstName: 'Maya', lastName: 'Lindqvist' });
    const second = await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor' });
    const asset = await createAsset(admin);

    const [a, b] = await Promise.all([
      assign(admin, asset.id, { employeeId: first.id, checkoutDate: '2026-03-14' }),
      assign(admin, asset.id, { employeeId: second.id, checkoutDate: '2026-03-14' }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(
      ctx.db.select().from(assignments).where(isNull(assignments.returnedAt)).all(),
    ).toHaveLength(1);
    expectInvariant(ctx.db);
  });

  it('leaves nothing behind when a freed asset is deleted', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const asset = await createAsset(admin);
    await assign(admin, asset.id, { employeeId: employee.id, checkoutDate: '2026-03-14' });
    await checkin(admin, asset.id, { returnDate: '2026-08-16', newStatus: 'available' });

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);
    expect(
      ctx.db.select().from(assignments).where(eq(assignments.assetId, asset.id)).all(),
    ).toEqual([]);
    expectInvariant(ctx.db);
  });
});

describe('what the detail pages read', () => {
  it('gives an asset its ownership history, newest first', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const maya = await createEmployee(admin, { firstName: 'Maya', lastName: 'Lindqvist' });
    const daniel = await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor' });
    const asset = await createAsset(admin);

    await assign(admin, asset.id, { employeeId: maya.id, checkoutDate: '2025-01-10' });
    await checkin(admin, asset.id, { returnDate: '2025-06-30', newStatus: 'available' });
    await assign(admin, asset.id, { employeeId: daniel.id, checkoutDate: '2026-02-01' });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);

    const history = res.json().history as {
      holderName: string;
      checkedOutAt: string;
      returnedAt: string | null;
      outcome: string | null;
    }[];
    expect(history.map((h) => h.holderName)).toEqual(['Daniel Okafor', 'Maya Lindqvist']);
    expect(history[0]).toMatchObject({
      checkedOutAt: '2026-02-01',
      returnedAt: null,
      outcome: null,
    });
    expect(history[1]).toMatchObject({ returnedAt: '2025-06-30', outcome: 'returned' });
  });

  it('keeps a departed holder in the history by name', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const leaver = await createEmployee(admin, { firstName: 'Elena', lastName: 'Vasquez' });
    const asset = await createAsset(admin);
    await assign(admin, asset.id, { employeeId: leaver.id, checkoutDate: '2025-01-10' });
    await checkin(admin, asset.id, { returnDate: '2025-06-30', newStatus: 'available' });
    await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/employees/${leaver.id}`,
      cookie: admin,
    });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
    });
    expect(res.json().history[0]).toMatchObject({
      holderName: 'Elena Vasquez',
      employeeId: null,
    });
  });

  it('gives an asset its own audit trail, newest first', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const asset = await createAsset(admin);
    await assign(admin, asset.id, { employeeId: employee.id, checkoutDate: '2026-03-14' });
    await checkin(admin, asset.id, { returnDate: '2026-08-16', newStatus: 'available' });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
    });
    const trail = res.json().auditTrail as { action: string; actorName: string }[];
    expect(trail.map((entry) => entry.action)).toEqual([
      'asset.checked_in',
      'asset.assigned',
      'asset.created',
    ]);
    expect(trail[0]!.actorName).toBe('Tomasz Kowalski');
    // Another asset's events never leak into this trail.
    const other = await createAsset(admin, { name: 'ThinkPad X1' });
    const otherRes = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${other.id}`,
      cookie: admin,
    });
    expect(otherRes.json().auditTrail).toHaveLength(1);
  });

  it('splits an employee page into what they hold and what they held', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const kept = await createAsset(admin, { name: 'MacBook Pro 14"' });
    const returned = await createAsset(admin, { name: 'iPhone 12' });

    await assign(admin, kept.id, { employeeId: employee.id, checkoutDate: '2026-02-01' });
    await assign(admin, returned.id, { employeeId: employee.id, checkoutDate: '2025-01-10' });
    await checkin(admin, returned.id, { returnDate: '2025-11-02', newStatus: 'in_repair' });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/employees/${employee.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee.activeAssetCount).toBe(1);

    const holdings = res.json().holdings as { assetName: string; checkedOutAt: string }[];
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ assetName: 'MacBook Pro 14"', checkedOutAt: '2026-02-01' });

    const history = res.json().history as { assetName: string; outcome: string }[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ assetName: 'iPhone 12', outcome: 'in_repair' });
  });
});
