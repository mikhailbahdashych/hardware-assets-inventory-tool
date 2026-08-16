import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  deriveOutcome,
  type AssignInput,
  type CheckinInput,
  type EmployeeStatus,
} from '@inventory/shared';
import type { AppDeps } from '@/app.js';
import type { DbOrTx } from '@/db/client.js';
import { assets, assignments, employees } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { serializeAsset, type Actor } from '@/lib/serialize.js';
import { writeAudit } from './audit.js';

export type AssignmentRow = typeof assignments.$inferSelect;

/** Statuses an asset can be handed out from. */
const ASSIGNABLE_FROM = new Set(['available', 'ordered']);

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

/**
 * Closes an ownership record and lands the asset in its new status together —
 * the mirror image of openAssignment, and the only way an asset may leave
 * `assigned`.
 *
 * Must be called inside the caller's transaction.
 */
export function closeAssignment(
  tx: DbOrTx,
  params: {
    assignment: AssignmentRow;
    returnedAt: string;
    newStatus: string;
    condition?: string | null;
    notes?: string | null;
    outcome: string;
  },
  now: Date,
): void {
  tx.update(assignments)
    .set({
      returnedAt: params.returnedAt,
      checkinCondition: params.condition ?? null,
      checkinNewStatus: params.newStatus,
      checkinNotes: params.notes ?? null,
      outcome: params.outcome,
    })
    .where(eq(assignments.id, params.assignment.id))
    .run();
  tx.update(assets)
    .set({ status: params.newStatus, updatedAt: nowIso(now) })
    .where(eq(assets.id, params.assignment.assetId))
    .run();
}

/** Every ownership record for an asset, newest checkout first. */
export function assetHistory(db: DbOrTx, assetId: string): AssignmentRow[] {
  return db
    .select()
    .from(assignments)
    .where(eq(assignments.assetId, assetId))
    .orderBy(desc(assignments.checkedOutAt), desc(assignments.createdAt))
    .all();
}

/** Everything a person has ever held, newest first. */
export function employeeHistory(db: DbOrTx, employeeId: string) {
  return db
    .select({ assignment: assignments, asset: assets })
    .from(assignments)
    .innerJoin(assets, eq(assets.id, assignments.assetId))
    .where(eq(assignments.employeeId, employeeId))
    .orderBy(desc(assignments.checkedOutAt), desc(assignments.createdAt))
    .all();
}

export function assignAsset(deps: AppDeps, actor: Actor, assetId: string, input: AssignInput) {
  const now = deps.now();

  return deps.db.transaction((tx) => {
    const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) throw notFound('That asset');

    // Both halves of the invariant are checked, not just the status column:
    // whichever one is wrong, the answer is the same.
    if (!ASSIGNABLE_FROM.has(asset.status) || activeAssignment(tx, assetId)) {
      throw new AppError(
        409,
        'asset_unavailable',
        'Only an available or ordered asset can be handed out.',
      );
    }

    const holder = tx.select().from(employees).where(eq(employees.id, input.employeeId)).get();
    if (!holder) throw invalidFields({ employeeId: 'That employee could not be found.' });
    if (holder.status !== 'active') {
      throw invalidFields({ employeeId: 'That person is offboarding and cannot take on assets.' });
    }

    const holderName = `${holder.firstName} ${holder.lastName}`;
    openAssignment(
      tx,
      {
        assetId,
        employeeId: holder.id,
        holderName,
        checkedOutAt: input.checkoutDate,
        expectedReturnDate: input.expectedReturnDate,
        notes: input.notes,
      },
      now,
    );
    writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.assigned',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        assetId,
        employeeId: holder.id,
        params: {
          assetName: asset.name,
          assetTag: asset.assetTag,
          holderName,
          checkedOutAt: input.checkoutDate,
        },
      },
      now,
    );

    return serializeAsset(
      tx.select().from(assets).where(eq(assets.id, assetId)).get()!,
      activeAssignment(tx, assetId) ?? null,
    );
  });
}

export function checkinAsset(deps: AppDeps, actor: Actor, assetId: string, input: CheckinInput) {
  const now = deps.now();

  return deps.db.transaction((tx) => {
    const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) throw notFound('That asset');

    const open = activeAssignment(tx, assetId);
    if (!open) {
      throw new AppError(409, 'asset_not_assigned', 'Nobody is holding this asset.');
    }
    if (input.returnDate < open.checkedOutAt) {
      throw invalidFields({
        returnDate: `This asset was checked out on ${open.checkedOutAt}.`,
      });
    }

    // The holder's own status is what makes a return an offboarding return.
    const holder = open.employeeId
      ? tx.select().from(employees).where(eq(employees.id, open.employeeId)).get()
      : undefined;
    const outcome = deriveOutcome({
      holderStatus: (holder?.status as EmployeeStatus | undefined) ?? null,
      newStatus: input.newStatus,
    });

    closeAssignment(
      tx,
      {
        assignment: open,
        returnedAt: input.returnDate,
        newStatus: input.newStatus,
        condition: input.condition,
        notes: input.notes,
        outcome,
      },
      now,
    );
    writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.checked_in',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        assetId,
        employeeId: open.employeeId,
        params: {
          assetName: asset.name,
          assetTag: asset.assetTag,
          holderName: open.holderNameSnapshot,
          outcome,
          to: input.newStatus,
          condition: input.condition ?? null,
        },
      },
      now,
    );

    return serializeAsset(tx.select().from(assets).where(eq(assets.id, assetId)).get()!, null);
  });
}
