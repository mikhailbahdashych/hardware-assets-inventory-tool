import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachments,
  auditEvents,
  authTokens,
  members,
  notifications,
  sessions,
} from '@/db/schema.js';
import { runMaintenance, runReturnReminders, runWarrantyScan } from '@/services/jobs.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const MONDAY = new Date('2026-08-17T08:00:00.000Z');

const day = (from: Date, days: number) =>
  new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function withApp(now: Date = MONDAY) {
  ctx = await buildTestApp({}, () => now);
  const admin = await setupOrg(ctx.app);
  return admin;
}

async function createAsset(cookie: string, body: Record<string, unknown>) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { category: 'laptops', status: 'available', ...body },
  });
  if (res.statusCode !== 200) throw new Error(`asset create failed: ${res.body}`);
  return res.json().asset as { id: string };
}

async function createEmployee(cookie: string, body: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io', ...body },
  });
  if (res.statusCode !== 200) throw new Error(`employee create failed: ${res.body}`);
  return res.json().employee as { id: string };
}

/** The inbox's personal bridge: a member account linked to the employee. */
async function linkMember(employeeId: string): Promise<string> {
  const id = newId();
  const at = nowIso();
  await ctx.db.insert(members).values({
    id,
    email: `linked-${id.slice(0, 8)}@acme.io`,
    displayName: 'Linked Member',
    passwordHash: 'not-used',
    role: 'viewer',
    status: 'active',
    employeeId,
    createdAt: at,
    updatedAt: at,
  });
  return id;
}

const inboxOf = (memberId: string) =>
  ctx.db.select().from(notifications).where(eq(notifications.memberId, memberId));

describe('the warranty scan', () => {
  it('writes one inbox row per expiring asset to whoever may edit assets, once', async () => {
    const admin = await withApp();
    await createAsset(admin, { name: 'Due soon', warrantyUntil: day(MONDAY, 20) });
    await createAsset(admin, { name: 'Due later', warrantyUntil: day(MONDAY, 120) });
    await createAsset(admin, { name: 'Already gone', warrantyUntil: day(MONDAY, -5) });

    // One recipient (the admin), one asset inside the 60-day lead time.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    const rows = await ctx.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    const params = JSON.parse(rows[0]!.params) as { assetName: string; days: number };
    expect(params.assetName).toBe('Due soon');
    expect(params.days).toBe(20);

    // Running again the same day writes nothing.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
    expect(await ctx.db.select().from(notifications)).toHaveLength(1);
  });

  it('re-arms when the warranty date is corrected', async () => {
    const admin = await withApp();
    const asset = await createAsset(admin, { name: 'Laptop', warrantyUntil: day(MONDAY, 20) });
    await runWarrantyScan(ctx.deps, MONDAY);

    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
      body: { warrantyUntil: day(MONDAY, 30) },
    });

    // A different date is a different alert, so the corrected one lands too.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    expect(await ctx.db.select().from(notifications)).toHaveLength(2);
  });

  it('uses the lead time the workspace set, not a fixed one', async () => {
    const admin = await withApp();
    await createAsset(admin, { name: 'Due in 20 days', warrantyUntil: day(MONDAY, 20) });
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { warrantyLeadDays: 14 },
    });

    // Inside the default 60 days, outside the 14 this workspace chose.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 0 });

    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { warrantyLeadDays: 21 },
    });
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
  });

  it('does nothing when the workspace has the alerts switched off', async () => {
    const admin = await withApp();
    await createAsset(admin, { name: 'Laptop', warrantyUntil: day(MONDAY, 20) });
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { warrantyAlerts: false },
    });

    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
    expect(await ctx.db.select().from(notifications)).toEqual([]);
  });
});

describe('return reminders', () => {
  async function assetDueBack(admin: string, dueInDays: number) {
    const maya = await createEmployee(admin);
    const memberId = await linkMember(maya.id);
    const asset = await createAsset(admin, {
      name: 'MacBook Pro 14"',
      status: 'assigned',
      assignedToEmployeeId: maya.id,
      checkoutDate: '2026-01-09',
    });
    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${maya.id}`,
      cookie: admin,
      body: { status: 'offboarding', returnDueDate: day(MONDAY, dueInDays) },
    });
    return { maya, memberId, asset };
  }

  it('reminds the linked member, and nobody else', async () => {
    const admin = await withApp();
    const { memberId } = await assetDueBack(admin, 2);

    expect(await runReturnReminders(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    const rows = await ctx.db.select().from(notifications);
    // The assignment itself notified the linked member too; the reminder is the
    // second row, and both belong to the one linked inbox.
    expect(rows.every((row) => row.memberId === memberId)).toBe(true);
    const reminder = rows.find((row) => row.kind === 'return.due')!;
    const params = JSON.parse(reminder.params) as { assetName: string; overdue: boolean };
    expect(params.assetName).toBe('MacBook Pro 14"');
    expect(params.overdue).toBe(false);
  });

  it('flags an overdue return and stays quiet about something far off', async () => {
    const admin = await withApp();
    await assetDueBack(admin, -4);
    expect((await runReturnReminders(ctx.deps, MONDAY)).sent).toBe(1);
    const reminder = (await ctx.db.select().from(notifications)).find(
      (row) => row.kind === 'return.due',
    )!;
    expect((JSON.parse(reminder.params) as { overdue: boolean }).overdue).toBe(true);

    await ctx.close();
    const other = await withApp();
    await assetDueBack(other, 30);
    expect(await runReturnReminders(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 0 });
  });

  it('nags once as the date nears, once more when it slips, never daily', async () => {
    const admin = await withApp();
    await assetDueBack(admin, 1);

    // Inside the lead window: one heads-up. A second run — even a day later,
    // on the due date itself — is the same fact under the same key, and the
    // unread row is still sitting in the inbox; there is nothing to repeat.
    expect((await runReturnReminders(ctx.deps, MONDAY)).sent).toBe(1);
    expect((await runReturnReminders(ctx.deps, MONDAY)).sent).toBe(0);
    const dueDay = new Date(MONDAY.getTime() + 86_400_000);
    expect((await runReturnReminders(ctx.deps, dueDay)).sent).toBe(0);

    // Slipping into overdue is a new fact: exactly one more row, then quiet.
    const overdue = new Date(MONDAY.getTime() + 2 * 86_400_000);
    expect((await runReturnReminders(ctx.deps, overdue)).sent).toBe(1);
    const later = new Date(MONDAY.getTime() + 3 * 86_400_000);
    expect((await runReturnReminders(ctx.deps, later)).sent).toBe(0);
  });

  it('says nothing about an assignment with no return date', async () => {
    const admin = await withApp();
    const maya = await createEmployee(admin);
    await linkMember(maya.id);
    await createAsset(admin, {
      name: 'MacBook Pro 14"',
      status: 'assigned',
      assignedToEmployeeId: maya.id,
      checkoutDate: '2026-01-09',
    });

    expect(await runReturnReminders(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 0 });
  });
});

describe('the orphan upload sweep', () => {
  /** A file on the volume with an mtime, and no row anywhere naming it. */
  function orphan(name: string, ageHours: number) {
    mkdirSync(ctx.uploadsDir, { recursive: true });
    const path = join(ctx.uploadsDir, name);
    writeFileSync(path, 'stray bytes');
    const at = new Date(MONDAY.getTime() - ageHours * 3_600_000);
    utimesSync(path, at, at);
    return path;
  }

  it('removes a stray file older than a day and keeps a fresh one', async () => {
    const admin = await withApp();
    const asset = await createAsset(admin, { name: 'MacBook Pro 14"' });
    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${asset.id}/attachments`,
      cookie: admin,
      payload: Buffer.concat([
        Buffer.from(
          '------b\r\nContent-Disposition: form-data; name="file"; filename="invoice.pdf"\r\n' +
            'Content-Type: application/pdf\r\n\r\n',
        ),
        Buffer.from('%PDF-1.7'),
        Buffer.from('\r\n------b--\r\n'),
      ]),
      headers: { 'content-type': 'multipart/form-data; boundary=----b' },
    });
    const kept = (await ctx.db.select().from(attachments))[0]!.storedName;
    // The real file is as old as the stray one; being referenced is what saves it.
    const at = new Date(MONDAY.getTime() - 72 * 3_600_000);
    utimesSync(join(ctx.uploadsDir, kept), at, at);

    const old = orphan('abandoned.pdf', 72);
    const young = orphan('in-flight.pdf', 2);

    const result = await runMaintenance(ctx.deps, MONDAY);
    expect(result.orphanUploadsRemoved).toBe(1);
    expect(existsSync(old)).toBe(false);
    // A file younger than a day may be an upload whose transaction has not landed.
    expect(existsSync(young)).toBe(true);
    expect(existsSync(join(ctx.uploadsDir, kept))).toBe(true);
  });

  it('sweeps nothing on an instance where nobody has uploaded anything', async () => {
    await withApp();
    expect(existsSync(ctx.uploadsDir)).toBe(false);
    expect((await runMaintenance(ctx.deps, MONDAY)).orphanUploadsRemoved).toBe(0);
  });
});

describe('the inbox prune', () => {
  it('keeps ninety days and drops the rest, read or not', async () => {
    const admin = await withApp();
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: admin });
    const memberId = me.json().member.id as string;
    const at = (days: number) => new Date(MONDAY.getTime() - days * 86_400_000).toISOString();
    await ctx.db.insert(notifications).values([
      { id: 'old', memberId, kind: 'warranty.expiring', params: '{}', createdAt: at(91) },
      { id: 'recent', memberId, kind: 'warranty.expiring', params: '{}', createdAt: at(89) },
    ]);

    const result = await runMaintenance(ctx.deps, MONDAY);
    expect(result.notificationRowsPruned).toBe(1);
    expect((await inboxOf(memberId)).map((row) => row.id)).toEqual(['recent']);
  });
});

describe('nightly maintenance', () => {
  it('removes what has expired and nothing that has not', async () => {
    const admin = await withApp();
    const at = new Date(MONDAY.getTime() - 86_400_000).toISOString();
    await ctx.db.insert(authTokens).values({
      id: 'expired-token',
      memberId: (await ctx.db.select().from(sessions))[0]!.memberId,
      purpose: 'invite',
      expiresAt: at,
      createdAt: at,
    });

    const result = await runMaintenance(ctx.deps, MONDAY);
    expect(result.pruned).toBeGreaterThanOrEqual(1);
    expect(
      await ctx.db.select().from(authTokens).where(eq(authTokens.id, 'expired-token')),
    ).toEqual([]);
    // The admin's own session has 30 days on it and must survive.
    expect(await ctx.db.select().from(sessions)).toHaveLength(1);
    expect(admin).toContain('inv_session=');
  });

  it('prunes the activity log past the retention the workspace chose', async () => {
    const admin = await withApp();
    await createAsset(admin, { name: 'MacBook Pro 14"' });

    // Backdate the setup event past the 12-month default.
    await ctx.db
      .update(auditEvents)
      .set({ at: '2024-01-01T00:00:00.000Z' })
      .where(eq(auditEvents.action, 'system.setup_completed'));

    await runMaintenance(ctx.deps, MONDAY);
    const left = await ctx.db.select().from(auditEvents);
    expect(left.map((row) => row.action)).toEqual(['asset.created']);
  });

  it('keeps everything when retention is Forever', async () => {
    const admin = await withApp();
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { logRetentionMonths: null },
    });
    await ctx.db.update(auditEvents).set({ at: '2019-01-01T00:00:00.000Z' });

    await runMaintenance(ctx.deps, MONDAY);
    expect((await ctx.db.select().from(auditEvents)).length).toBeGreaterThan(0);
  });
});
