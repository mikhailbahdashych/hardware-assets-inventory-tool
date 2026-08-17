import { desc, eq, sql } from 'drizzle-orm';
import {
  AUDIT_TYPE_LABELS,
  AUDIT_TYPES,
  renderAuditEvent,
  toCsv,
  type AuditParams,
  type AuditType,
} from '@inventory/shared';
import type { Db } from '@/types/db.js';
import type { AuditItem, AuditPage, AuditQuery, AuditTypeCounts } from '@/types/admin.js';
import { auditEvents } from '@/db/schema.js';
import { AppError } from '@/lib/errors.js';

// Reading the audit log. Writing it lives in services/audit.ts, beside the
// rule that every mutation writes its event in the same transaction.

export const DEFAULT_AUDIT_LIMIT = 200;
export const MAX_AUDIT_LIMIT = 500;

/**
 * One page of the activity log, newest first, plus a count behind every filter
 * pill. The counts are taken over the whole log rather than the page, so
 * switching pills never makes the other numbers move.
 */
export function auditPage(db: Db, query: AuditQuery): AuditPage {
  const rows = db
    .select()
    .from(auditEvents)
    .where(query.type ? eq(auditEvents.type, query.type) : undefined)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(query.limit)
    .offset(query.offset)
    .all();

  const counts = typeCounts(db);
  return {
    items: rows.map(toItem),
    typeCounts: counts,
    total: query.type ? counts[query.type] : counts.all,
  };
}

/** The same rows the screen shows, as a file — one renderer, so they agree. */
export function auditCsv(db: Db, type?: AuditType): string {
  const rows = db
    .select()
    .from(auditEvents)
    .where(type ? eq(auditEvents.type, type) : undefined)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .all()
    .map(toItem);

  return toCsv(
    ['Time', 'Actor', 'Event', 'Type'],
    rows.map((item) => [
      item.at,
      item.actorName,
      renderAuditEvent(item),
      AUDIT_TYPE_LABELS[item.type],
    ]),
  );
}

function typeCounts(db: Db): AuditTypeCounts {
  const rows = db
    .select({ type: auditEvents.type, count: sql<number>`count(*)` })
    .from(auditEvents)
    .groupBy(auditEvents.type)
    .all();

  // Every pill needs a number even when nothing of that kind has happened, so
  // the counts start at zero rather than being absent from the map.
  const counts: AuditTypeCounts = { all: 0, assets: 0, people: 0, auth: 0, system: 0 };
  for (const row of rows) {
    counts.all += row.count;
    counts[auditTypeOf(row.type)] = row.count;
  }
  return counts;
}

function toItem(row: typeof auditEvents.$inferSelect): AuditItem {
  return {
    id: row.id,
    at: row.at,
    type: auditTypeOf(row.type),
    action: row.action,
    actorName: row.actorName,
    assetId: row.assetId,
    employeeId: row.employeeId,
    memberId: row.memberId,
    // params is NOT NULL DEFAULT '{}' and only ever written by JSON.stringify,
    // so it always parses. A throw here would be a corrupt row, not a guess.
    params: JSON.parse(row.params) as AuditParams,
  };
}

/**
 * The type column is TEXT with no CHECK constraint, like every enum here, but
 * `writeAudit` is its only writer and it takes an `AuditType`. A value outside
 * the list means a row nothing can file under a pill or colour, so it says so
 * instead of rendering an event under a colour that does not exist.
 */
function auditTypeOf(value: string): AuditType {
  if (!(AUDIT_TYPES as readonly string[]).includes(value)) {
    throw new AppError(
      500,
      'unknown_audit_type',
      `An audit event is stored under the unknown type "${value}".`,
    );
  }
  return value as AuditType;
}
