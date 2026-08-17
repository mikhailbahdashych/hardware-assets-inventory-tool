import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { renderAuditEvent, type AuditParams } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { JobResult } from '@/types/jobs.js';
import {
  assets,
  assignments,
  auditEvents,
  authTokens,
  employees,
  members,
  sessions,
} from '@/db/schema.js';
import { pruneExpiredSessions } from './sessions.js';
import { getSettings } from './settings.js';
import { emailEnabled, sendOnce } from './notifications.js';
import { returnReminderEmail, warrantyAlertEmail, weeklyDigestEmail } from './mail-templates.js';

// The scheduled work, as four plain functions of (deps, now). node-cron only
// decides when to call them — see scheduler.ts — so every rule here is testable
// by handing it a date, and a missed run is simply skipped rather than queued.

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far past due a return reminder starts nagging, and how far ahead. */
const RETURN_LEAD_DAYS = 3;

/** How many events the weekly digest recounts. A digest is not a log. */
const DIGEST_EVENTS = 10;

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const shiftDays = (date: Date, days: number): string =>
  dayOf(new Date(date.getTime() + days * DAY_MS));

/**
 * Devices whose warranty runs out inside the workspace's lead time, mailed to
 * the admins as one message. Deduped on the asset **and its warranty date**, so
 * correcting the date re-arms the alert rather than swallowing it.
 */
export async function runWarrantyScan(deps: AppDeps, now: Date): Promise<JobResult> {
  const settings = getSettings(deps.db);
  if (!deps.mailer || !emailEnabled(settings, 'emailWarrantyAlerts')) return skipped();

  const today = dayOf(now);
  const horizon = shiftDays(now, settings.warrantyLeadDays);
  const expiring = deps.db
    .select({
      id: assets.id,
      name: assets.name,
      assetTag: assets.assetTag,
      warrantyUntil: assets.warrantyUntil,
    })
    .from(assets)
    .where(
      and(
        isNotNull(assets.warrantyUntil),
        gte(assets.warrantyUntil, today),
        lte(assets.warrantyUntil, horizon),
      ),
    )
    .orderBy(asc(assets.warrantyUntil))
    .all()
    .flatMap((row) =>
      row.warrantyUntil === null ? [] : [{ ...row, warrantyUntil: row.warrantyUntil }],
    );

  if (expiring.length === 0) return { sent: 0, skipped: 0 };

  // One message per asset-and-date, but batched into one email per admin: the
  // dedupe key of the batch is every asset in it, so an asset joining the list
  // tomorrow produces a new message rather than being swallowed by today's.
  const dedupeKey = `warranty:${expiring.map((row) => `${row.id}@${row.warrantyUntil}`).join(',')}`;
  const content = warrantyAlertEmail({
    orgName: settings.orgName,
    assets: expiring.map((row) => ({
      name: row.name,
      assetTag: row.assetTag,
      warrantyUntil: row.warrantyUntil,
      daysLeft: Math.round((Date.parse(row.warrantyUntil) - Date.parse(today)) / DAY_MS),
    })),
    url: `${deps.config.appUrl}/dashboard`,
  });

  let sent = 0;
  for (const admin of activeAdmins(deps)) {
    if (
      await sendOnce(deps, {
        kind: 'warranty',
        dedupeKey: `${dedupeKey}:${admin.id}`,
        to: admin.email,
        content,
      })
    ) {
      sent += 1;
    }
  }
  return { sent, skipped: sent === 0 ? 1 : 0 };
}

/**
 * People holding something that is due back — soon or already overdue — mailed
 * one message each listing all of it. Keyed on the day, so a reminder repeats
 * daily while the item stays out rather than going quiet after the first.
 */
export async function runReturnReminders(deps: AppDeps, now: Date): Promise<JobResult> {
  const settings = getSettings(deps.db);
  if (!deps.mailer || !emailEnabled(settings, 'emailReturnReminders')) return skipped();

  const due = deps.db
    .select({
      assignmentId: assignments.id,
      expectedReturnDate: assignments.expectedReturnDate,
      assetName: assets.name,
      assetTag: assets.assetTag,
      employeeId: employees.id,
      email: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(assignments)
    .innerJoin(assets, eq(assets.id, assignments.assetId))
    .innerJoin(employees, eq(employees.id, assignments.employeeId))
    .where(
      and(
        isNull(assignments.returnedAt),
        isNotNull(assignments.expectedReturnDate),
        lte(assignments.expectedReturnDate, shiftDays(now, RETURN_LEAD_DAYS)),
      ),
    )
    .orderBy(asc(assignments.expectedReturnDate))
    .all();

  // One message per person, however many things they are holding. The value is
  // a non-empty tuple because it is only ever created with a row in it — which
  // is what lets `holder` below be read without a check for a case the
  // construction makes impossible.
  type DueRow = (typeof due)[number];
  const byPerson = new Map<string, [DueRow, ...DueRow[]]>();
  for (const row of due) {
    const existing = byPerson.get(row.employeeId);
    if (existing) existing.push(row);
    else byPerson.set(row.employeeId, [row]);
  }

  let sent = 0;
  for (const [employeeId, rows] of byPerson) {
    const [holder] = rows;
    const content = returnReminderEmail({
      orgName: settings.orgName,
      holderName: `${holder.firstName} ${holder.lastName}`,
      assets: rows.flatMap((row) =>
        row.expectedReturnDate === null
          ? []
          : [
              {
                name: row.assetName,
                assetTag: row.assetTag,
                expectedReturnDate: row.expectedReturnDate,
              },
            ],
      ),
      url: `${deps.config.appUrl}/employees/${employeeId}`,
    });
    if (
      await sendOnce(deps, {
        kind: 'return_reminder',
        dedupeKey: `return:${employeeId}:${dayOf(now)}`,
        to: holder.email,
        content,
      })
    ) {
      sent += 1;
    }
  }
  return { sent, skipped: byPerson.size - sent };
}

/**
 * Monday's summary for admins, keyed on the ISO week — so a restart on Monday
 * afternoon does not send it twice, and a missed Monday is simply missed.
 */
export async function runWeeklyDigest(deps: AppDeps, now: Date): Promise<JobResult> {
  const settings = getSettings(deps.db);
  if (!deps.mailer || !emailEnabled(settings, 'emailWeeklyDigest')) return skipped();

  const counts = deps.db
    .select({ status: assets.status, count: sql<number>`count(*)` })
    .from(assets)
    .groupBy(assets.status)
    .all();
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const countFor = (status: string) => counts.find((row) => row.status === status)?.count ?? 0;

  const week = isoWeek(now);
  const content = weeklyDigestEmail({
    orgName: settings.orgName,
    assetCount: total,
    assignedCount: countFor('assigned'),
    availableCount: countFor('available'),
    recentActivity: deps.db
      .select()
      .from(auditEvents)
      .where(gte(auditEvents.at, new Date(now.getTime() - 7 * DAY_MS).toISOString()))
      .orderBy(desc(auditEvents.at))
      .limit(DIGEST_EVENTS)
      .all()
      // params is NOT NULL DEFAULT '{}' and only ever written by JSON.stringify.
      .map((row) =>
        renderAuditEvent({ action: row.action, params: JSON.parse(row.params) as AuditParams }),
      ),
    url: `${deps.config.appUrl}/dashboard`,
  });

  let sent = 0;
  for (const admin of activeAdmins(deps)) {
    if (
      await sendOnce(deps, {
        kind: 'weekly_digest',
        dedupeKey: `digest:${week}:${admin.id}`,
        to: admin.email,
        content,
      })
    ) {
      sent += 1;
    }
  }
  return { sent, skipped: sent === 0 ? 1 : 0 };
}

/**
 * Nightly tidying, and the only place rows are ever removed without somebody
 * asking: expired sessions, spent or expired tokens, and audit events past the
 * workspace's retention. Retention is opt-out — `null` months means forever.
 */
export function runMaintenance(deps: AppDeps, now: Date): { pruned: number } {
  const settings = getSettings(deps.db);
  const at = now.toISOString();
  let pruned = 0;

  pruneExpiredSessions(deps.db, now);
  pruned += deps.db.delete(authTokens).where(lt(authTokens.expiresAt, at)).run().changes;
  pruned += deps.db.delete(sessions).where(lt(sessions.expiresAt, at)).run().changes;

  if (settings.logRetentionMonths !== null) {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - settings.logRetentionMonths);
    // This trims per-asset trails too, which the Settings page says out loud.
    pruned += deps.db
      .delete(auditEvents)
      .where(lt(auditEvents.at, cutoff.toISOString()))
      .run().changes;
  }

  return { pruned };
}

/** Who a workspace-level message goes to. An invited admin cannot read it yet. */
function activeAdmins(deps: AppDeps) {
  return deps.db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(and(eq(members.role, 'admin'), eq(members.status, 'active')))
    .all();
}

/**
 * "2026-W34" — stable across a restart, which is what the digest keys on.
 *
 * Counted as ISO 8601 defines it and not by the usual one-line trick: a week
 * belongs to the year of its **Thursday**, and week 1 is the one containing
 * January 4th. Measuring Monday-to-Monday says both of those out loud, where
 * the arithmetic version is off by one at exactly the boundaries a digest hits.
 */
export function isoWeek(date: Date): string {
  const midnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const mondayIndex = (midnight.getUTCDay() + 6) % 7;

  const thursday = new Date(midnight);
  thursday.setUTCDate(midnight.getUTCDate() - mondayIndex + 3);
  const year = thursday.getUTCFullYear();

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));

  const monday = new Date(midnight);
  monday.setUTCDate(midnight.getUTCDate() - mondayIndex);

  const week = 1 + Math.round((monday.getTime() - firstMonday.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const skipped = (): JobResult => ({ sent: 0, skipped: 1 });
