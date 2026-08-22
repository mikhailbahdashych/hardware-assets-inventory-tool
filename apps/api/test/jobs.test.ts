import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { attachments, auditEvents, authTokens, notificationLog, sessions } from '@/db/schema.js';
import {
  isoWeek,
  runMaintenance,
  runReturnReminders,
  runWarrantyScan,
  runWeeklyDigest,
} from '@/services/jobs.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const SMTP = { SMTP_HOST: 'smtp.acme.io', SMTP_FROM: 'IT <it@acme.io>' };
const MONDAY = new Date('2026-08-17T08:00:00.000Z');

const day = (from: Date, days: number) =>
  new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function withMail(now: Date = MONDAY) {
  ctx = await buildTestApp(SMTP, () => now);
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

describe('the warranty scan', () => {
  it('mails the admins once about what is expiring inside the lead time', async () => {
    const admin = await withMail();
    await createAsset(admin, { name: 'Due soon', warrantyUntil: day(MONDAY, 20) });
    await createAsset(admin, { name: 'Due later', warrantyUntil: day(MONDAY, 120) });
    await createAsset(admin, { name: 'Already gone', warrantyUntil: day(MONDAY, -5) });

    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]!.to).toBe('tomasz@acme.io');
    expect(ctx.sent[0]!.text).toContain('Due soon');
    expect(ctx.sent[0]!.text).toContain('20 days left');
    // Outside the 60-day lead time, and one whose alert is already moot.
    expect(ctx.sent[0]!.text).not.toContain('Due later');
    expect(ctx.sent[0]!.text).not.toContain('Already gone');

    // Running again the same day sends nothing.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
    expect(ctx.sent).toHaveLength(1);
  });

  it('re-arms when the warranty date is corrected', async () => {
    const admin = await withMail();
    const asset = await createAsset(admin, { name: 'Laptop', warrantyUntil: day(MONDAY, 20) });
    await runWarrantyScan(ctx.deps, MONDAY);
    expect(ctx.sent).toHaveLength(1);

    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${asset.id}`,
      cookie: admin,
      body: { warrantyUntil: day(MONDAY, 30) },
    });

    // A different date is a different alert, so the corrected one goes out.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    expect(ctx.sent[1]!.text).toContain('30 days left');
  });

  it('uses the lead time the workspace set, not a fixed one', async () => {
    const admin = await withMail();
    await createAsset(admin, { name: 'Due in 20 days', warrantyUntil: day(MONDAY, 20) });
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { warrantyLeadDays: 14 },
    });

    // Inside the default 60 days, outside the 14 this workspace chose.
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 0 });
    expect(ctx.sent).toEqual([]);

    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { warrantyLeadDays: 21 },
    });
    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
  });

  it('does nothing when the workspace has the alerts switched off', async () => {
    const admin = await withMail();
    await createAsset(admin, { name: 'Laptop', warrantyUntil: day(MONDAY, 20) });
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { emailWarrantyAlerts: false },
    });

    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
    expect(ctx.sent).toEqual([]);
  });

  it('does nothing at all on an instance with no SMTP', async () => {
    ctx = await buildTestApp({}, () => MONDAY);
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, { name: 'Laptop', warrantyUntil: day(MONDAY, 20) });

    expect(await runWarrantyScan(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
    expect(await ctx.db.select().from(notificationLog).all()).toEqual([]);
  });
});

describe('return reminders', () => {
  async function assetDueBack(admin: string, dueInDays: number) {
    const maya = await createEmployee(admin);
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
    return { maya, asset };
  }

  it('mails the holder, not the admins', async () => {
    const admin = await withMail();
    await assetDueBack(admin, 2);

    expect(await runReturnReminders(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    expect(ctx.sent[0]!.to).toBe('maya@acme.io');
    expect(ctx.sent[0]!.text).toContain('MacBook Pro 14"');
    expect(ctx.sent[0]!.text).toContain('Maya Lindqvist');
  });

  it('nags about something overdue and stays quiet about something far off', async () => {
    const admin = await withMail();
    await assetDueBack(admin, -4);
    expect((await runReturnReminders(ctx.deps, MONDAY)).sent).toBe(1);

    await ctx.close();
    const other = await withMail();
    await assetDueBack(other, 30);
    expect(await runReturnReminders(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 0 });
  });

  it('sends one message a day while the item stays out', async () => {
    const admin = await withMail();
    await assetDueBack(admin, 1);

    expect((await runReturnReminders(ctx.deps, MONDAY)).sent).toBe(1);
    expect((await runReturnReminders(ctx.deps, MONDAY)).sent).toBe(0);

    // Tomorrow is a new reminder: the item is still out, and more overdue.
    const tomorrow = new Date(MONDAY.getTime() + 86_400_000);
    expect((await runReturnReminders(ctx.deps, tomorrow)).sent).toBe(1);
    expect(ctx.sent).toHaveLength(2);
  });

  it('says nothing about an assignment with no return date', async () => {
    const admin = await withMail();
    const maya = await createEmployee(admin);
    await createAsset(admin, {
      name: 'MacBook Pro 14"',
      status: 'assigned',
      assignedToEmployeeId: maya.id,
      checkoutDate: '2026-01-09',
    });

    expect(await runReturnReminders(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 0 });
  });
});

describe('the weekly digest', () => {
  it('summarizes the fleet and the week, once', async () => {
    const admin = await withMail();
    await createAsset(admin, { name: 'MacBook Pro 14"' });

    expect(await runWeeklyDigest(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
    // It is off by default; a workspace opts in.
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { emailWeeklyDigest: true },
    });

    expect(await runWeeklyDigest(ctx.deps, MONDAY)).toEqual({ sent: 1, skipped: 0 });
    expect(ctx.sent[0]!.subject).toBe('Acme Corp Inventory · this week');
    expect(ctx.sent[0]!.text).toContain('1 assets tracked');
    // Sentences from the same renderer the activity log uses.
    expect(ctx.sent[0]!.text).toContain('Added MacBook Pro 14" to the inventory');

    expect(await runWeeklyDigest(ctx.deps, MONDAY)).toEqual({ sent: 0, skipped: 1 });
  });

  it('is a new digest next week', async () => {
    const admin = await withMail();
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { emailWeeklyDigest: true },
    });
    await runWeeklyDigest(ctx.deps, MONDAY);

    const nextMonday = new Date(MONDAY.getTime() + 7 * 86_400_000);
    expect((await runWeeklyDigest(ctx.deps, nextMonday)).sent).toBe(1);
    expect(ctx.sent).toHaveLength(2);
  });
});

describe('isoWeek', () => {
  it('is stable within a week and changes at its boundary', () => {
    expect(isoWeek(new Date('2026-08-17T00:00:00Z'))).toBe('2026-W34');
    expect(isoWeek(new Date('2026-08-23T23:59:00Z'))).toBe('2026-W34');
    expect(isoWeek(new Date('2026-08-24T00:00:00Z'))).toBe('2026-W35');
  });

  it('gives a year-straddling week to the year of its Thursday', () => {
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
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
    const admin = await withMail();
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
    const kept = (await ctx.db.select().from(attachments).all())[0]!.storedName;
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
    await withMail();
    expect(existsSync(ctx.uploadsDir)).toBe(false);
    expect((await runMaintenance(ctx.deps, MONDAY)).orphanUploadsRemoved).toBe(0);
  });
});

describe('the notification log prune', () => {
  it('keeps a year of what was sent and drops the rest', async () => {
    await withMail();
    const at = (months: number) => {
      const date = new Date(MONDAY);
      date.setUTCMonth(date.getUTCMonth() - months);
      return date.toISOString();
    };
    await ctx.db
      .insert(notificationLog)
      .values([
        { id: 'old', kind: 'warranty', dedupeKey: 'warranty:old', sentAt: at(13) },
        { id: 'recent', kind: 'warranty', dedupeKey: 'warranty:recent', sentAt: at(11) },
      ])
      .run();

    const result = await runMaintenance(ctx.deps, MONDAY);
    expect(result.notificationRowsPruned).toBe(1);
    expect((await ctx.db.select().from(notificationLog).all()).map((row) => row.id)).toEqual(['recent']); // prettier-ignore
  });
});

describe('nightly maintenance', () => {
  it('removes what has expired and nothing that has not', async () => {
    const admin = await withMail();
    const at = new Date(MONDAY.getTime() - 86_400_000).toISOString();
    await ctx.db
      .insert(authTokens)
      .values({
        id: 'expired-token',
        memberId: (await ctx.db.select().from(sessions).get())!.memberId,
        purpose: 'invite',
        expiresAt: at,
        createdAt: at,
      })
      .run();

    const result = await runMaintenance(ctx.deps, MONDAY);
    expect(result.pruned).toBeGreaterThanOrEqual(1);
    expect(
      await ctx.db.select().from(authTokens).where(eq(authTokens.id, 'expired-token')).all(),
    ).toEqual([]);
    // The admin's own session has 30 days on it and must survive.
    expect(await ctx.db.select().from(sessions).all()).toHaveLength(1);
    expect(admin).toContain('inv_session=');
  });

  it('prunes the activity log past the retention the workspace chose', async () => {
    const admin = await withMail();
    await createAsset(admin, { name: 'MacBook Pro 14"' });

    // Backdate the setup event past the 12-month default.
    await ctx.db
      .update(auditEvents)
      .set({ at: '2024-01-01T00:00:00.000Z' })
      .where(eq(auditEvents.action, 'system.setup_completed'))
      .run();

    await runMaintenance(ctx.deps, MONDAY);
    const left = await ctx.db.select().from(auditEvents).all();
    expect(left.map((row) => row.action)).toEqual(['asset.created']);
  });

  it('keeps everything when retention is Forever', async () => {
    const admin = await withMail();
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { logRetentionMonths: null },
    });
    await ctx.db.update(auditEvents).set({ at: '2019-01-01T00:00:00.000Z' }).run();

    await runMaintenance(ctx.deps, MONDAY);
    expect((await ctx.db.select().from(auditEvents).all()).length).toBeGreaterThan(0);
  });
});
