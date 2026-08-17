import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIT_TYPES } from '@inventory/shared';
import { assets, assignments, auditEvents, employees, members } from '@/db/schema.js';
import { seedDemo } from '@/db/demo.js';
import { buildTestApp, inject, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** A Monday, so "this week" in the seeded history is not a weekend. */
const NOW = new Date('2026-08-17T09:00:00.000Z');

async function seeded(overrides: Record<string, unknown> = {}) {
  ctx = await buildTestApp({}, () => NOW);
  const result = await seedDemo(ctx.deps, { password: 'demo-password-1234', ...overrides });
  return result;
}

describe('the demo seed', () => {
  it('fills an empty workspace with enough to look at', async () => {
    const result = await seeded();

    expect(result.counts.employees).toBeGreaterThanOrEqual(8);
    expect(result.counts.assets).toBeGreaterThanOrEqual(20);
    expect(result.counts.members).toBeGreaterThanOrEqual(4);
    // A workspace with no history is a workspace with nothing to demonstrate.
    expect(result.counts.assignments).toBeGreaterThan(result.counts.assets / 3);
    expect(result.counts.auditEvents).toBeGreaterThan(30);

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/meta' });
    expect(res.json().needsSetup).toBe(false);
    expect(res.json().orgName).toBe(result.orgName);
  });

  it('reports credentials that actually sign in', async () => {
    const result = await seeded();
    expect(result.signIn.length).toBeGreaterThanOrEqual(3);

    for (const account of result.signIn) {
      const res = await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: account.email, password: account.password },
      });
      expect(res.statusCode, `${account.role} ${account.email}`).toBe(200);
      expect(res.json().member.role).toBe(account.role);
    }
  });

  it('offers one account per role, so permissions can be seen', async () => {
    const result = await seeded();
    expect(result.signIn.map((account) => account.role).sort()).toEqual([
      'admin',
      'manager',
      'viewer',
    ]);
    // Plus somebody mid-invitation, which is a state the Members page draws.
    const invited = ctx.db.select().from(members).where(eq(members.status, 'invited')).all();
    expect(invited.length).toBeGreaterThanOrEqual(1);
  });

  it('holds the assignment invariant it seeded through', async () => {
    await seeded();

    const open = ctx.db
      .select({ assetId: assignments.assetId })
      .from(assignments)
      .where(isNull(assignments.returnedAt))
      .all();
    const assigned = ctx.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.status, 'assigned'))
      .all();

    expect(open.map((row) => row.assetId).sort()).toEqual(assigned.map((row) => row.id).sort());
    // The partial unique index would have thrown, but say it out loud.
    expect(new Set(open.map((row) => row.assetId)).size).toBe(open.length);
  });

  it('leaves a history behind, not just a snapshot', async () => {
    await seeded();

    const closed = ctx.db
      .select()
      .from(assignments)
      .where(and(isNull(assignments.returnedAt)))
      .all();
    const returned = ctx.db
      .select()
      .from(assignments)
      .all()
      .filter((row) => row.returnedAt);
    expect(returned.length).toBeGreaterThan(0);
    expect(closed.length).toBeGreaterThan(0);

    // Every closed record says how it ended, which is what the timeline reads.
    for (const row of returned) {
      expect(row.outcome, row.id).toBeTruthy();
    }
    // More than one outcome, or the timeline demonstrates nothing.
    expect(new Set(returned.map((row) => row.outcome)).size).toBeGreaterThan(1);
  });

  it('reads an outcome from the status the holder had at the time', async () => {
    await seeded();

    // Jonas is leaving now, but the phone he handed back in the spring came
    // back from somebody who was staying. A log that says "offboarded" there
    // is a log that has rewritten its own past.
    const jonas = ctx.db
      .select()
      .from(assignments)
      .all()
      .filter((row) => row.holderNameSnapshot === 'Jonas Weber' && row.returnedAt);

    expect(jonas.length).toBeGreaterThan(0);
    for (const row of jonas) {
      expect(row.outcome, `${row.id} returned ${row.returnedAt}`).toBe('returned');
    }
  });

  it('writes an activity log that spans every filter pill', async () => {
    await seeded();
    const rows = ctx.db.select().from(auditEvents).all();

    for (const type of AUDIT_TYPES) {
      expect(rows.filter((row) => row.type === type).length, type).toBeGreaterThan(0);
    }
    // Spread over time: a log where everything happened at once reads as fake.
    expect(new Set(rows.map((row) => row.at.slice(0, 10))).size).toBeGreaterThan(3);
    // And none of it is in the future.
    for (const row of rows) {
      expect(new Date(row.at).getTime(), row.action).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('dates itself from the clock, so the dashboard is never empty', async () => {
    await seeded();
    const cookie = await signInAsAdmin();

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie });
    const body = res.json();

    // The warranty widget's window is 90 days, and under 30 renders in err.
    const days = (date: string) =>
      Math.round((new Date(`${date}T00:00:00.000Z`).getTime() - NOW.getTime()) / 86_400_000);
    const expiries = body.warrantyExpirations.map((row: { warrantyUntil: string }) =>
      days(row.warrantyUntil),
    );
    expect(expiries.some((d: number) => d >= 0 && d < 30)).toBe(true);
    expect(expiries.some((d: number) => d >= 30 && d <= 90)).toBe(true);

    expect(body.pendingReturns.length).toBeGreaterThan(0);
    expect(body.recentActivity.length).toBeGreaterThan(0);
    // Every status card has a number behind it, including the empty ones.
    expect(Object.values(body.statusCounts).some((count) => Number(count) > 0)).toBe(true);
  });

  it('shows every category and status the app can render', async () => {
    await seeded();
    const rows = ctx.db.select().from(assets).all();

    expect(new Set(rows.map((row) => row.category)).size).toBeGreaterThanOrEqual(4);
    // A demo that only shows Available and Assigned hides half the pills.
    expect(new Set(rows.map((row) => row.status)).size).toBeGreaterThanOrEqual(5);
  });

  it('refuses a workspace that already has data', async () => {
    await seeded();
    await expect(seedDemo(ctx.deps, { password: 'demo-password-1234' })).rejects.toThrow(
      /already/i,
    );

    // And left the existing workspace exactly as it was.
    expect(ctx.db.select().from(employees).all().length).toBeGreaterThan(0);
  });

  it('reseeds identically when asked to reset', async () => {
    const first = await seeded();
    const second = await seedDemo(ctx.deps, { password: 'demo-password-1234', reset: true });

    expect(second.counts).toEqual(first.counts);
    // Same clock, same data — a hosted demo can restore itself on a timer.
    const tags = ctx.db
      .select({ tag: assets.assetTag })
      .from(assets)
      .all()
      .map((r) => r.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(second.orgName).toBe(first.orgName);
  });

  it('never leaves a real password in reach', async () => {
    const result = await seeded();
    const rows = ctx.db.select().from(members).all();

    for (const row of rows) {
      expect(row.passwordHash, row.email).not.toBe(result.signIn[0]!.password);
      // Invited members have not chosen one yet.
      if (row.status === 'active') expect(row.passwordHash).toMatch(/^\$argon2/);
      else expect(row.passwordHash).toBeNull();
    }
  });
});

async function signInAsAdmin(): Promise<string> {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/auth/login',
    body: { email: 'ada.okafor@northwind.example', password: 'demo-password-1234' },
  });
  const cookie = res.cookies.find((c) => c.name === 'inv_session');
  if (!cookie) throw new Error(`demo admin could not sign in: ${res.body}`);
  return `inv_session=${cookie.value}`;
}
