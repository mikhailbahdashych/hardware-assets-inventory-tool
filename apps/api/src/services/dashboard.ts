import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { ASSET_CATEGORIES } from '@inventory/shared';
import type { Db } from '@/types/db.js';
import type {
  CategoryCount,
  DashboardPayload,
  PendingReturn,
  StatusCount,
  WarrantyExpiry,
} from '@/types/dashboard.js';
import { assets, assignments, auditEvents } from '@/db/schema.js';
import { toAuditItem } from './audit-log.js';
import { getWorkflow } from './workflow.js';

/** What each widget shows at most. Cards have a shape; a list of forty has none. */
const RECENT_ACTIVITY = 8;
const WARRANTY_ROWS = 5;
const PENDING_RETURN_ROWS = 5;

/**
 * The design's warranty window. Deliberately independent of the
 * `warrantyLeadDays` setting, which is only about when email goes out: the
 * dashboard is a place to look, not a notification.
 */
const WARRANTY_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function dashboardPayload(db: Db, now: Date): Promise<DashboardPayload> {
  const rows = await db
    .select({ status: assets.status, category: assets.category, count: sql<number>`count(*)` })
    .from(assets)
    .groupBy(assets.status, assets.category)
    .all();

  const statusTotals = new Map<string, number>();
  const categoryTotals = zeroed(ASSET_CATEGORIES);
  let assetCount = 0;
  for (const row of rows) {
    assetCount += row.count;
    // A count is kept per slug and matched to a status below. A slug with no
    // status row still counts towards the total, but there is no tile or bar
    // to put it on — the same rule the categories have always followed.
    statusTotals.set(row.status, (statusTotals.get(row.status) ?? 0) + row.count);
    if (isKnown(ASSET_CATEGORIES, row.category)) categoryTotals[row.category] += row.count;
  }

  // Every status the workspace has, in its own order, carrying what the tile
  // renders with — so the page needs no vocabulary of its own.
  const statusCounts: StatusCount[] = (await getWorkflow(db)).statuses.map((status) => ({
    id: status.id,
    label: status.label,
    color: status.color,
    // A status nothing carries is a real zero, and the design draws its tile
    // anyway: an empty Retired column is information.
    count: statusTotals.get(status.id) ?? 0,
  }));

  const categoryCounts: CategoryCount[] = ASSET_CATEGORIES.map((category) => ({
    category,
    count: categoryTotals[category],
  }));

  return {
    assetCount,
    statusCounts,
    categoryCounts,
    recentActivity: (
      await db
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.at), desc(auditEvents.id))
        .limit(RECENT_ACTIVITY)
        .all()
    ).map(toAuditItem),
    warrantyExpirations: await warrantyExpirations(db, now),
    pendingReturns: await pendingReturns(db),
  };
}

/**
 * Future-only, inside the window, soonest first. An expired warranty drops off:
 * its alert has already been and gone, and a widget full of things you can no
 * longer act on is a widget people stop reading.
 */
async function warrantyExpirations(db: Db, now: Date): Promise<WarrantyExpiry[]> {
  const today = now.toISOString().slice(0, 10);
  const limit = new Date(now.getTime() + WARRANTY_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  return (
    (
      await db
        .select({
          assetId: assets.id,
          name: assets.name,
          assetTag: assets.assetTag,
          warrantyUntil: assets.warrantyUntil,
        })
        .from(assets)
        .where(
          and(
            sql`${assets.warrantyUntil} >= ${today}`,
            sql`${assets.warrantyUntil} <= ${limit}`,
            isNotNull(assets.warrantyUntil),
          ),
        )
        .orderBy(asc(assets.warrantyUntil))
        .limit(WARRANTY_ROWS)
        .all()
    )
      // The WHERE clause is what makes the date non-null, and a nullable column
      // cannot say so — flatMap narrows it without an assertion that would also
      // hide a genuine change to the query.
      .flatMap((row) =>
        row.warrantyUntil === null
          ? []
          : [
              {
                assetId: row.assetId,
                name: row.name,
                assetTag: row.assetTag,
                warrantyUntil: row.warrantyUntil,
                daysLeft: daysBetween(today, row.warrantyUntil),
              },
            ],
      )
  );
}

/** Open ownership records that carry a date — offboarding is what sets those. */
async function pendingReturns(db: Db): Promise<PendingReturn[]> {
  return (
    await db
      .select({
        assetId: assets.id,
        assetName: assets.name,
        assetTag: assets.assetTag,
        employeeId: assignments.employeeId,
        holderName: assignments.holderNameSnapshot,
        expectedReturnDate: assignments.expectedReturnDate,
      })
      .from(assignments)
      .innerJoin(assets, eq(assets.id, assignments.assetId))
      .where(and(isNull(assignments.returnedAt), isNotNull(assignments.expectedReturnDate)))
      .orderBy(asc(assignments.expectedReturnDate))
      .limit(PENDING_RETURN_ROWS)
      .all()
  ).flatMap((row) =>
    row.expectedReturnDate === null ? [] : [{ ...row, expectedReturnDate: row.expectedReturnDate }],
  );
}

/** Whole days between two date-only strings, both read as UTC midnight. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function zeroed<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function isKnown<T extends string>(keys: readonly T[], value: string): value is T {
  return (keys as readonly string[]).includes(value);
}
