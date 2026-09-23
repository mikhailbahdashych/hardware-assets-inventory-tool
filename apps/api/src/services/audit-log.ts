import { and, count, desc, eq, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AUDIT_ACTOR_KINDS,
  AUDIT_TYPE_LABELS,
  AUDIT_TYPES,
  renderAuditEvent,
  toCsv,
  type AuditActorKind,
  type AuditParams,
  type AuditType,
} from '@inventory/shared';
import type { Db } from '@/types/db.js';
import type {
  AuditExportQuery,
  AuditItem,
  AuditPage,
  AuditQuery,
  AuditTypeCounts,
} from '@/types/admin.js';
import { auditEvents } from '@/db/schema.js';
import { AppError } from '@/lib/errors.js';

// Reading the audit log. Writing it lives in services/audit.ts, beside the
// rule that every mutation writes its event in the same transaction.

export const DEFAULT_AUDIT_LIMIT = 200;
export const MAX_AUDIT_LIMIT = 500;

/**
 * The querystrings the two log endpoints take, beside the bounds they enforce
 * — same reasoning as `listQuery` in `lib/search.ts`. They live here rather
 * than in `modules/admin.ts` because the public surface serves the same two
 * routes: one schema, so screen, file and integrator cannot disagree about
 * what a filter means.
 */
export const auditTypeFilter = z.enum(AUDIT_TYPES).optional();
export const auditActorKindFilter = z.enum(AUDIT_ACTOR_KINDS).optional();

export const auditQuery = z.object({
  type: auditTypeFilter,
  actorKind: auditActorKindFilter,
  limit: z.coerce.number().int().min(1).max(MAX_AUDIT_LIMIT).default(DEFAULT_AUDIT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export const auditExportQuery = z.object({
  type: auditTypeFilter,
  actorKind: auditActorKindFilter,
});

/**
 * The two filters as one condition. Kept together so the page, its counts and
 * the export cannot read the same querystring differently.
 */
function where(query: AuditExportQuery): SQL | undefined {
  return and(query.type ? eq(auditEvents.type, query.type) : undefined, actorWhere(query));
}

/**
 * The actor filter, in SQL. It has to mirror `actorKindOf` exactly rather than
 * compare the column, because **NULL there means "written before the column
 * existed"** and nothing backfills it: a literal `actor_kind = 'member'` would
 * hide an upgraded instance's entire history from the filter that is supposed
 * to be showing it. No token could have written one of those rows, which is
 * why `token` is the one kind the column alone answers for.
 */
function actorWhere(query: AuditExportQuery): SQL | undefined {
  const kind = query.actorKind;
  if (kind === undefined) return undefined;
  if (kind === 'token') return eq(auditEvents.actorKind, 'token');
  return or(
    eq(auditEvents.actorKind, kind),
    and(
      isNull(auditEvents.actorKind),
      kind === 'member' ? isNotNull(auditEvents.actorMemberId) : isNull(auditEvents.actorMemberId),
    ),
  );
}

/**
 * One page of the activity log, newest first, plus a count behind every filter
 * pill.
 *
 * The two numbers serve different masters. **`total` obeys every filter**,
 * because it is what the pager divides — a wider number under a narrower view
 * offers pages the filter has no rows for. **`typeCounts` obeys the actor
 * filter and ignores the type one**, so switching a pill never moves the other
 * pills' numbers, while picking an actor does: it is the log's shape for that
 * actor. `listAssets` splits its `total` from its `statusCounts` the same way.
 */
export async function auditPage(db: Db, query: AuditQuery): Promise<AuditPage> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(where(query))
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(query.limit)
    .offset(query.offset);

  const counts = await typeCounts(db, actorWhere(query));
  return {
    items: rows.map(toAuditItem),
    typeCounts: counts,
    total: query.type ? counts[query.type] : counts.all,
  };
}

/** The same rows the screen shows, as a file — one renderer, so they agree. */
export async function auditCsv(db: Db, query: AuditExportQuery): Promise<string> {
  const rows = (
    await db
      .select()
      .from(auditEvents)
      .where(where(query))
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
  ).map(toAuditItem);

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

async function typeCounts(db: Db, actor: SQL | undefined): Promise<AuditTypeCounts> {
  const rows = await db
    .select({ type: auditEvents.type, count: count() })
    .from(auditEvents)
    .where(actor)
    .groupBy(auditEvents.type);

  // Every pill needs a number even when nothing of that kind has happened, so
  // the counts start at zero rather than being absent from the map.
  const counts: AuditTypeCounts = { all: 0, assets: 0, people: 0, auth: 0, system: 0 };
  for (const row of rows) {
    counts.all += row.count;
    counts[auditTypeOf(row.type)] = row.count;
  }
  return counts;
}

/** One stored row as every reader of the log sees it. */
export function toAuditItem(row: typeof auditEvents.$inferSelect): AuditItem {
  return {
    id: row.id,
    at: row.at,
    type: auditTypeOf(row.type),
    action: row.action,
    actorKind: actorKindOf(row),
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
/**
 * What kind of actor a stored row belongs to.
 *
 * `actor_kind` is NULL exactly on rows written before the column existed, the
 * way `attachments.sha256` is NULL on files uploaded before checksums — so the
 * coalescing below is the meaning of that NULL and not a rescue. No token could
 * write a row back then, which makes "a member id or nobody" the whole truth
 * those rows ever carried; the derivation recovers precisely that and invents
 * nothing. Every row written from here on says so itself.
 */
function actorKindOf(row: typeof auditEvents.$inferSelect): AuditActorKind {
  if (row.actorKind === null) return row.actorMemberId === null ? 'system' : 'member';
  if (!(AUDIT_ACTOR_KINDS as readonly string[]).includes(row.actorKind)) {
    throw new AppError(
      500,
      'unknown_actor_kind',
      `An audit event is stored under the unknown actor kind "${row.actorKind}".`,
    );
  }
  return row.actorKind as AuditActorKind;
}

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
