import { and, asc, eq, gte, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import type { AppDeps } from '@/types/app.js';
import type { JobResult, MaintenanceResult } from '@/types/jobs.js';
import {
  assets,
  assignments,
  attachments,
  auditEvents,
  authTokens,
  notifications,
  sessions,
} from '@/db/schema.js';
import { pruneExpiredSessions } from './sessions.js';
import { getSettings } from './settings.js';
import { notifyActionHolders, notifyLinkedMember } from './notifications.js';

// The scheduled work, as three plain functions of (deps, now). node-cron only
// decides when to call them — see scheduler.ts — so every rule here is testable
// by handing it a date, and a missed run is simply skipped rather than queued.

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far past due a return reminder starts nagging, and how far ahead. */
const RETURN_LEAD_DAYS = 3;

/** How long a file with no row naming it is given before the sweep takes it. */
const ORPHAN_GRACE_MS = DAY_MS;

/** How long an inbox row is worth reading. The bell shows fifty; ninety days is history. */
const INBOX_RETENTION_DAYS = 90;

const skipped = (): JobResult => ({ sent: 0, skipped: 1 });

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const shiftDays = (date: Date, days: number): string =>
  dayOf(new Date(date.getTime() + days * DAY_MS));

/**
 * Devices whose warranty runs out inside the workspace's lead time, one inbox
 * row per asset for every member whose role may edit assets. Deduped on the
 * asset **and its warranty date**, so correcting the date re-arms the alert
 * rather than swallowing it.
 */
export async function runWarrantyScan(deps: AppDeps, now: Date): Promise<JobResult> {
  const settings = await getSettings(deps.db);
  if (!settings.warrantyAlerts) return skipped();

  const today = dayOf(now);
  const horizon = shiftDays(now, settings.warrantyLeadDays);
  const expiring = (
    await deps.db
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
  ).flatMap((row) =>
    row.warrantyUntil === null ? [] : [{ ...row, warrantyUntil: row.warrantyUntil }],
  );

  let sent = 0;
  let deduped = 0;
  for (const row of expiring) {
    const written = await notifyActionHolders(
      deps.db,
      'assets.edit',
      {
        kind: 'warranty.expiring',
        params: {
          assetName: row.name,
          assetTag: row.assetTag,
          days: Math.round((Date.parse(row.warrantyUntil) - Date.parse(today)) / DAY_MS),
        },
        dedupeKey: `warranty:${row.id}:${row.warrantyUntil}`,
      },
      now,
    );
    if (written > 0) sent += written;
    else deduped += 1;
  }
  return { sent, skipped: deduped };
}

/**
 * Returns due soon or overdue, one inbox row per assignment to the member
 * account linked to the holder — the personal half of the inbox. A holder with
 * no linked member hears nothing here; the dashboard's pending-returns widget
 * is the operational surface that still shows it. Keyed on the assignment, the
 * date and which side of it today is: one heads-up as the date nears, one more
 * when it slips, and editing the date re-arms both. Never daily — an unread
 * row is still sitting in the inbox, and a drip of duplicates would push
 * everything else off a 50-row panel.
 */
export async function runReturnReminders(deps: AppDeps, now: Date): Promise<JobResult> {
  const settings = await getSettings(deps.db);
  if (!settings.returnReminders) return skipped();

  const due = await deps.db
    .select({
      assignmentId: assignments.id,
      expectedReturnDate: assignments.expectedReturnDate,
      assetName: assets.name,
      assetTag: assets.assetTag,
      employeeId: assignments.employeeId,
    })
    .from(assignments)
    .innerJoin(assets, eq(assets.id, assignments.assetId))
    .where(
      and(
        isNull(assignments.returnedAt),
        isNotNull(assignments.expectedReturnDate),
        lte(assignments.expectedReturnDate, shiftDays(now, RETURN_LEAD_DAYS)),
      ),
    )
    .orderBy(asc(assignments.expectedReturnDate));

  let sent = 0;
  let unheard = 0;
  for (const row of due) {
    if (row.employeeId === null) {
      unheard += 1;
      continue;
    }
    // The where clause holds isNotNull(expectedReturnDate); the ! names it.
    const date = row.expectedReturnDate!;
    const overdue = date < dayOf(now);
    const written = await notifyLinkedMember(
      deps.db,
      row.employeeId,
      {
        kind: 'return.due',
        params: {
          assetName: row.assetName,
          assetTag: row.assetTag,
          date,
          overdue,
        },
        dedupeKey: `return:${row.assignmentId}:${date}:${overdue ? 'overdue' : 'due'}`,
      },
      now,
    );
    if (written > 0) sent += written;
    else unheard += 1;
  }
  return { sent, skipped: unheard };
}

/**
 * Nightly tidying, and the only place rows are ever removed without somebody
 * asking: expired sessions, spent or expired tokens, audit events past the
 * workspace's retention, inbox rows older than ninety days, and files on the
 * volume that no attachment row names. Retention is opt-out — `null` months
 * means forever — but the last two are not: neither is the workspace's data.
 */
export async function runMaintenance(deps: AppDeps, now: Date): Promise<MaintenanceResult> {
  const settings = await getSettings(deps.db);
  const at = now.toISOString();
  let pruned = 0;

  await pruneExpiredSessions(deps.db, now);
  // How many rows a delete took is the one result shape the two drivers do not
  // agree on — libsql answers `rowsAffected`, node-postgres `rowCount`. Both
  // dialects support RETURNING, so the deleted ids are the count, said in a way
  // neither driver gets to name.
  pruned += (
    await deps.db
      .delete(authTokens)
      .where(lt(authTokens.expiresAt, at))
      .returning({ id: authTokens.id })
  ).length;
  pruned += (
    await deps.db.delete(sessions).where(lt(sessions.expiresAt, at)).returning({ id: sessions.id })
  ).length;

  if (settings.logRetentionMonths !== null) {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - settings.logRetentionMonths);
    // This trims per-asset trails too, which the Settings page says out loud.
    pruned += (
      await deps.db
        .delete(auditEvents)
        .where(lt(auditEvents.at, cutoff.toISOString()))
        .returning({ id: auditEvents.id })
    ).length;
  }

  // Every dedupe window is measured in days at most, so ninety days of inbox
  // is kept for reading rather than for deciding — read or not; an inbox is
  // not the audit log, which is the record and has its own retention.
  const notificationCutoff = new Date(now.getTime() - INBOX_RETENTION_DAYS * DAY_MS);
  const notificationRowsPruned = (
    await deps.db
      .delete(notifications)
      .where(lt(notifications.createdAt, notificationCutoff.toISOString()))
      .returning({ id: notifications.id })
  ).length;

  return {
    pruned,
    orphanUploadsRemoved: await sweepOrphanUploads(deps, now),
    notificationRowsPruned,
  };
}

/**
 * Stored objects that no attachment row names — a delete whose row landed and
 * whose removal did not, a restore of `/data` from a newer database, an upload
 * refused after its bytes were written. Anything younger than a day is left
 * alone: it may be an upload whose transaction has not landed yet, and a sweep
 * that races a live request is worse than a stray file.
 *
 * It asks the storage seam rather than the filesystem, so it sweeps a bucket on
 * an instance whose attachments live in one — same rule, same grace period.
 *
 * The count goes back to the scheduler, which logs the whole result through
 * pino — operations, not the activity log: nobody in the workspace did this.
 */
async function sweepOrphanUploads(deps: AppDeps, now: Date): Promise<number> {
  const stored = await deps.storage.list();
  const referenced = new Set(
    (await deps.db.select({ storedName: attachments.storedName }).from(attachments)).map(
      (row) => row.storedName,
    ),
  );

  let removed = 0;
  for (const object of stored) {
    if (referenced.has(object.name)) continue;
    if (now.getTime() - object.lastModified.getTime() < ORPHAN_GRACE_MS) continue;
    // Best effort, as it always was: something else may have taken it between
    // the listing and here, and that is the outcome asked for anyway.
    await deps.storage.remove(object.name).catch(() => {});
    removed += 1;
  }
  return removed;
}
