import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client.js';
import { assets, assignments } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';

export type AssignmentRow = typeof assignments.$inferSelect;

/** The open ownership record for an asset, or null when nobody holds it. */
export function activeAssignment(db: DbOrTx, assetId: string): AssignmentRow | undefined {
  return db
    .select()
    .from(assignments)
    .where(and(eq(assignments.assetId, assetId), isNull(assignments.returnedAt)))
    .get();
}

/**
 * Opens an ownership record and moves the asset to `assigned` together — the
 * one code path that may create that pairing, so `status = 'assigned'` ⇔ an
 * active assignment exists always holds. The partial unique index on
 * `(asset_id) WHERE returned_at IS NULL` is the structural backstop.
 *
 * Must be called inside the caller's transaction.
 */
export function openAssignment(
  tx: DbOrTx,
  params: {
    assetId: string;
    employeeId: string;
    holderName: string;
    checkedOutAt: string;
    expectedReturnDate?: string | null;
    notes?: string | null;
  },
  now: Date,
): string {
  const id = newId();
  tx.insert(assignments)
    .values({
      id,
      assetId: params.assetId,
      employeeId: params.employeeId,
      holderNameSnapshot: params.holderName,
      checkedOutAt: params.checkedOutAt,
      expectedReturnDate: params.expectedReturnDate ?? null,
      checkoutNotes: params.notes ?? null,
      createdAt: nowIso(now),
    })
    .run();
  tx.update(assets)
    .set({ status: 'assigned', updatedAt: nowIso(now) })
    .where(eq(assets.id, params.assetId))
    .run();
  return id;
}
