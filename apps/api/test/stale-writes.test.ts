import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, assignments, auditEvents, members, notifications } from '@/db/schema.js';
import { writeAssetRow } from '@/services/assets.js';
import { closeAssignment } from '@/services/assignments.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

// The two writes that move a status off a row somebody read are compare-and-
// set: on PostgreSQL under READ COMMITTED two transactions can read the same
// row, and only a condition on the write itself makes the second one notice.
// `app.inject` cannot make that race happen on demand, so each service is
// handed the same stale row twice — a write that trusted it would succeed both
// times. The parallel HTTP check-in is the race as it really arrives.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

async function assignedAsset() {
  ctx = await buildTestApp();
  const admin = await setupOrg(ctx.app);
  const employee = (
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie: admin,
      body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io' },
    })
  ).json().employee as { id: string };
  const asset = (
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: {
        name: 'ThinkPad X1',
        category: 'laptops',
        status: 'assigned',
        assignedToEmployeeId: employee.id,
        checkoutDate: '2026-01-05',
      },
    })
  ).json().asset as { id: string };
  return { admin, employeeId: employee.id, assetId: asset.id };
}

describe('a status write on a row somebody else already moved', () => {
  it('lets one of two edits holding the same read through, and answers the other 409', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const { id } = (
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/assets',
        cookie: admin,
        body: { name: 'ThinkPad X1', category: 'laptops', status: 'available' },
      })
    ).json().asset as { id: string };
    const [stale] = await ctx.db.select().from(assets).where(eq(assets.id, id));

    await ctx.db.transaction(async (tx) => writeAssetRow(tx, stale!, { status: 'in_repair' }));
    await expect(
      ctx.db.transaction(async (tx) => writeAssetRow(tx, stale!, { status: 'retired' })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'asset_changed' });

    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, id));
    expect(row!.status).toBe('in_repair');
  });

  it('closes an ownership record once, even for a caller holding the open row read before', async () => {
    const { assetId } = await assignedAsset();
    const [open] = await ctx.db
      .select()
      .from(assignments)
      .where(and(eq(assignments.assetId, assetId), isNull(assignments.returnedAt)));
    const close = (newStatus: string) =>
      ctx.db.transaction(async (tx) =>
        closeAssignment(
          tx,
          { assignment: open!, returnedAt: '2026-02-01', newStatus, outcome: 'returned' },
          new Date(),
        ),
      );

    await close('available');
    await expect(close('in_repair')).rejects.toMatchObject({
      statusCode: 409,
      code: 'asset_not_assigned',
    });
    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, assetId));
    expect(row!.status).toBe('available');
  });

  it('lets exactly one of several check-ins racing over HTTP through', async () => {
    const { admin, employeeId, assetId } = await assignedAsset();
    // The holder signs in, so each check-in would also write them a notice.
    await memberCookie(ctx.db, 'viewer');
    await ctx.db.update(members).set({ employeeId }).where(eq(members.role, 'viewer'));

    // Warm the pool, or the later requests spend their head start opening
    // connections and the first has committed by then.
    await Promise.all([0, 1, 2, 3].map(() => ctx.db.select().from(members)));
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        inject(ctx.app, {
          method: 'POST',
          url: `/api/v1/assets/${assetId}/checkin`,
          cookie: admin,
          body: { returnDate: '2026-02-01', newStatus: 'available' },
        }),
      ),
    );

    const statuses = results.map((res) => res.statusCode);
    expect(
      statuses.filter((status) => status === 200),
      statuses.join(),
    ).toHaveLength(1);
    for (const res of results.filter((res) => res.statusCode !== 200)) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('asset_not_assigned');
    }
    const events = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'asset.checked_in'));
    expect(events).toHaveLength(1);
    const notices = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'assignment.checked_in'));
    expect(notices).toHaveLength(1);
  });
});
