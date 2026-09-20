import { afterEach, describe, expect, it } from 'vitest';
import { runReturnReminders, runWarrantyScan } from '@/services/jobs.js';
import {
  buildTestApp,
  inject,
  memberCookie,
  sessionCookie,
  setupOrg,
  type TestApp,
} from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const DAY = 24 * 60 * 60 * 1000;

/** An employee with a linked member account — the inbox's personal target. */
async function linkedEmployee(cookie: string) {
  const employee = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io' },
  });
  const employeeId = employee.json().employee.id as string;
  const invite = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/members/invites',
    cookie,
    body: { email: 'maya@acme.io', role: 'viewer', employeeId },
  });
  const token = new URL(invite.json().inviteUrl as string).searchParams.get('token')!;
  const joined = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/auth/accept-invite',
    body: { token, name: 'Maya Lindqvist', password: 'Mayas-own-pass1' },
  });
  return { employeeId, memberCookie: sessionCookie(joined) };
}

async function createAsset(cookie: string, body: Record<string, unknown>) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { category: 'laptops', status: 'available', customValues: {}, ...body },
  });
  return res.json().asset.id as string;
}

describe('the inbox', () => {
  it('hands an assignment notification to the linked member, and the check-in back', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { employeeId, memberCookie: maya } = await linkedEmployee(cookie);
    const assetId = await createAsset(cookie, { name: 'MacBook Pro' });

    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${assetId}/assign`,
      cookie,
      body: { employeeId, checkoutDate: '2026-09-20' },
    });

    const inbox = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: maya,
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().unreadCount).toBe(1);
    expect(inbox.json().notifications[0]).toMatchObject({
      kind: 'assignment.received',
      params: { assetName: 'MacBook Pro' },
      readAt: null,
    });

    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${assetId}/checkin`,
      cookie,
      body: { returnDate: '2026-09-21', newStatus: 'available' },
    });
    const after = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: maya,
    });
    expect(after.json().unreadCount).toBe(2);
    expect(after.json().notifications[0].kind).toBe('assignment.checked_in');
  });

  it('marks everything read in one gesture, and only for the member who looked', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { employeeId, memberCookie: maya } = await linkedEmployee(cookie);
    const assetId = await createAsset(cookie, { name: 'Dock' });
    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${assetId}/assign`,
      cookie,
      body: { employeeId, checkoutDate: '2026-09-20' },
    });

    const read = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/notifications/read',
      cookie: maya,
    });
    expect(read.statusCode).toBe(204);
    const inbox = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: maya,
    });
    expect(inbox.json().unreadCount).toBe(0);
    expect(inbox.json().notifications[0].readAt).not.toBeNull();
  });

  it('warranty alerts go to everyone whose role manages assets, exactly once per date', async () => {
    const now = new Date('2026-09-20T08:00:00Z');
    ctx = await buildTestApp({}, () => now);
    const cookie = await setupOrg(ctx.app);
    await createAsset(cookie, { name: 'Aging laptop', warrantyUntil: '2026-10-01' });
    // A viewer holds no assets.manage and must hear nothing.
    const viewer = await memberCookie(ctx.db, 'viewer');

    const first = await runWarrantyScan(ctx.deps, now);
    expect(first.sent).toBe(1); // the admin
    const again = await runWarrantyScan(ctx.deps, now);
    expect(again.sent).toBe(0); // deduped on asset + date

    const admin = await inject(ctx.app, { method: 'GET', url: '/api/v1/notifications', cookie });
    expect(admin.json().notifications[0]).toMatchObject({ kind: 'warranty.expiring' });
    const nothing = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: viewer,
    });
    expect(nothing.json().notifications).toHaveLength(0);
  });

  it('reminds the linked member of a due return, daily, and nobody when no link exists', async () => {
    const now = new Date('2026-09-20T08:05:00Z');
    ctx = await buildTestApp({}, () => now);
    const cookie = await setupOrg(ctx.app);
    const { employeeId, memberCookie: maya } = await linkedEmployee(cookie);
    const assetId = await createAsset(cookie, { name: 'iPad' });
    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${assetId}/assign`,
      cookie,
      body: { employeeId, checkoutDate: '2026-09-10', expectedReturnDate: '2026-09-21' },
    });
    // An unlinked employee holding something due: no inbox to reach, no row.
    const lone = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie,
      body: { firstName: 'Lone', lastName: 'Holder', email: 'lone@acme.io' },
    });
    const otherAsset = await createAsset(cookie, { name: 'Monitor' });
    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${otherAsset}/assign`,
      cookie,
      body: {
        employeeId: lone.json().employee.id,
        checkoutDate: '2026-09-10',
        expectedReturnDate: '2026-09-19',
      },
    });

    const result = await runReturnReminders(ctx.deps, now);
    expect(result.sent).toBe(1);
    const inbox = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: maya,
    });
    const kinds = inbox.json().notifications.map((n: { kind: string }) => n.kind);
    expect(kinds).toContain('return.due');

    // The next day is a new reminder, not a swallowed one.
    const tomorrow = new Date(now.getTime() + DAY);
    const second = await runReturnReminders(ctx.deps, tomorrow);
    expect(second.sent).toBe(1);
  });
});
