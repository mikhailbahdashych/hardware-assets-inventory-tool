import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { members, notifications } from '@/db/schema.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';
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

    // A second linked inbox, to prove the gesture stays personal.
    const omar = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie,
      body: { firstName: 'Omar', lastName: 'Haddad', email: 'omar@acme.io' },
    });
    const omarId = newId();
    const at = nowIso();
    await ctx.db.insert(members).values({
      id: omarId,
      email: 'omar-member@acme.io',
      displayName: 'Omar Haddad',
      passwordHash: 'not-used',
      role: 'viewer',
      status: 'active',
      employeeId: omar.json().employee.id as string,
      createdAt: at,
      updatedAt: at,
    });
    const second = await createAsset(cookie, { name: 'Second Dock' });
    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${second}/assign`,
      cookie,
      body: { employeeId: omar.json().employee.id, checkoutDate: '2026-09-20' },
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

    // Omar looked at nothing, so his row is exactly as it was.
    const omarRows = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.memberId, omarId));
    expect(omarRows).toHaveLength(1);
    expect(omarRows[0]!.readAt).toBeNull();
  });

  it('pages the history: limit and offset on the query, the total for the footer', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { employeeId, memberCookie: maya } = await linkedEmployee(cookie);
    for (const name of ['One', 'Two', 'Three']) {
      const assetId = await createAsset(cookie, { name });
      await inject(ctx.app, {
        method: 'POST',
        url: `/api/v1/assets/${assetId}/assign`,
        cookie,
        body: { employeeId, checkoutDate: '2026-09-20' },
      });
    }

    const page = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications?limit=2',
      cookie: maya,
    });
    expect(page.json().notifications).toHaveLength(2);
    expect(page.json().total).toBe(3);
    // The unread badge counts the whole inbox, not the page.
    expect(page.json().unreadCount).toBe(3);

    // The second page: what the first one left, with the counts unmoved.
    const second = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications?limit=2&offset=2',
      cookie: maya,
    });
    expect(second.json().notifications).toHaveLength(1);
    expect(second.json().total).toBe(3);
    expect(second.json().unreadCount).toBe(3);

    const everything = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: maya,
    });
    expect(everything.json().notifications).toHaveLength(3);
    expect(everything.json().total).toBe(3);
  });

  it('warranty alerts go to everyone whose role manages assets, exactly once per date', async () => {
    const now = new Date('2026-09-20T08:00:00Z');
    ctx = await buildTestApp({}, () => now);
    const cookie = await setupOrg(ctx.app);
    await createAsset(cookie, { name: 'Aging laptop', warrantyUntil: '2026-10-01' });
    // A viewer holds no assets.edit and must hear nothing; a manager holds it
    // by grant, not by name — which is what lets invented roles inherit this.
    const viewer = await memberCookie(ctx.db, 'viewer');
    const manager = await memberCookie(ctx.db, 'manager');

    const first = await runWarrantyScan(ctx.deps, now);
    expect(first.sent).toBe(2); // the admin, and the manager by grant
    const again = await runWarrantyScan(ctx.deps, now);
    expect(again.sent).toBe(0); // deduped on asset + date

    const admin = await inject(ctx.app, { method: 'GET', url: '/api/v1/notifications', cookie });
    expect(admin.json().notifications[0]).toMatchObject({ kind: 'warranty.expiring' });
    const heard = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: manager,
    });
    expect(heard.json().notifications[0]).toMatchObject({ kind: 'warranty.expiring' });
    const nothing = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/notifications',
      cookie: viewer,
    });
    expect(nothing.json().notifications).toHaveLength(0);
  });

  it('reminds the linked member of a due return, again when it slips, and nobody unlinked', async () => {
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

    // The same fact repeats to nobody; the slip into overdue is one new row.
    expect((await runReturnReminders(ctx.deps, now)).sent).toBe(0);
    const slipped = new Date(now.getTime() + 2 * DAY);
    expect((await runReturnReminders(ctx.deps, slipped)).sent).toBe(1);
  });
});
