import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  deriveOutcome,
  type AssignInput,
  type CheckinInput,
  type EmployeeStatus,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { DbOrTx } from '@/types/db.js';
import type { Actor } from '@/types/audit.js';
import type {
  AssignmentRow,
  CloseAssignmentParams,
  HolderContact,
  OpenAssignmentParams,
} from '@/types/assignments.js';
import { assets, assignments, employees } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { serializeAsset } from '@/lib/serialize.js';
import { writeAudit } from './audit.js';
import { assignableStatuses, requireStatus } from './workflow.js';

/**
 * "Available or Ordered" as the workspace currently writes it — the message
 * has to name the admin's own statuses, because a hard-coded pair stops being
 * true the moment somebody edits the workflow.
 */
async function assignableList(tx: DbOrTx): Promise<string> {
  const labels = (await assignableStatuses(tx)).map((row) => row.label);
  // The guard below only runs when the asset's own status is not assignable,
  // and the workflow service refuses to leave a workspace with none — so this
  // list is never empty when a caller reads it.
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}

/**
 * The open ownership record for an asset, or null when nobody holds it.
 * "Nobody holds it" is a real answer, so it is spelled null rather than left
 * as drizzle's undefined — callers then need no coalescing of their own.
 */
export async function activeAssignment(db: DbOrTx, assetId: string): Promise<AssignmentRow | null> {
  return (
    (await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.assetId, assetId), isNull(assignments.returnedAt)))
      .get()) ?? null
  );
}

/**
 * Opens an ownership record and moves the asset to `assigned` together — the
 * one code path that may create that pairing, so `status = 'assigned'` ⇔ an
 * active assignment exists always holds. The partial unique index on
 * `(asset_id) WHERE returned_at IS NULL` is the structural backstop.
 *
 * Must be called inside the caller's transaction. The two `?? null` below are
 * the columns' meaning, not a default: no agreed return date and no handover
 * note are both real, storable states.
 */
export async function openAssignment(
  tx: DbOrTx,
  params: OpenAssignmentParams,
  now: Date,
): Promise<string> {
  const id = newId();
  await tx
    .insert(assignments)
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
  await tx
    .update(assets)
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
 * Must be called inside the caller's transaction. As with openAssignment, an
 * unrecorded condition or note is stored as NULL because that is what it is.
 */
export async function closeAssignment(
  tx: DbOrTx,
  params: CloseAssignmentParams,
  now: Date,
): Promise<void> {
  await tx
    .update(assignments)
    .set({
      returnedAt: params.returnedAt,
      checkinCondition: params.condition ?? null,
      checkinNewStatus: params.newStatus,
      checkinNotes: params.notes ?? null,
      outcome: params.outcome,
    })
    .where(eq(assignments.id, params.assignment.id))
    .run();
  await tx
    .update(assets)
    .set({ status: params.newStatus, updatedAt: nowIso(now) })
    .where(eq(assets.id, params.assignment.assetId))
    .run();
}

/** Every ownership record for an asset, newest checkout first. */
export async function assetHistory(db: DbOrTx, assetId: string): Promise<AssignmentRow[]> {
  return await db
    .select()
    .from(assignments)
    .where(eq(assignments.assetId, assetId))
    .orderBy(desc(assignments.checkedOutAt), desc(assignments.createdAt))
    .all();
}

/** Everything a person has ever held, newest first. */
export async function employeeHistory(db: DbOrTx, employeeId: string) {
  return await db
    .select({ assignment: assignments, asset: assets })
    .from(assignments)
    .innerJoin(assets, eq(assets.id, assignments.assetId))
    .where(eq(assignments.employeeId, employeeId))
    .orderBy(desc(assignments.checkedOutAt), desc(assignments.createdAt))
    .all();
}

/**
 * Who to write to about an asset that is out right now. Read separately from
 * the operations themselves, and *before* a check-in, because afterwards there
 * is by definition nobody holding it any more.
 */
export async function currentHolderContact(
  db: DbOrTx,
  assetId: string,
): Promise<HolderContact | null> {
  const open = await activeAssignment(db, assetId);
  if (!open?.employeeId) return null;
  const holder = await db.select().from(employees).where(eq(employees.id, open.employeeId)).get();
  if (!holder) return null;
  return { email: holder.email, name: `${holder.firstName} ${holder.lastName}` };
}

export async function assignAsset(
  deps: AppDeps,
  actor: Actor,
  assetId: string,
  input: AssignInput,
) {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const asset = await tx.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) throw notFound('That asset');

    // Both halves of the invariant are checked, not just the status column:
    // whichever one is wrong, the answer is the same. An asset somebody holds
    // reads `assigned`, which is never assignable, so the message is true of
    // the reachable cases either way.
    if (
      !(await requireStatus(tx, asset.status)).assignableFrom ||
      (await activeAssignment(tx, assetId))
    ) {
      throw new AppError(
        409,
        'asset_unavailable',
        `Only an asset that is ${await assignableList(tx)} can be handed out.`,
      );
    }

    const holder = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, input.employeeId))
      .get();
    if (!holder) throw invalidFields({ employeeId: 'That employee could not be found.' });
    if (holder.status !== 'active') {
      throw invalidFields({ employeeId: 'That person is offboarding and cannot take on assets.' });
    }

    const holderName = `${holder.firstName} ${holder.lastName}`;
    await openAssignment(
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
    await writeAudit(
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
      (await tx.select().from(assets).where(eq(assets.id, assetId)).get())!,
      await activeAssignment(tx, assetId),
    );
  });
}

export async function checkinAsset(
  deps: AppDeps,
  actor: Actor,
  assetId: string,
  input: CheckinInput,
) {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const asset = await tx.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) throw notFound('That asset');

    const open = await activeAssignment(tx, assetId);
    if (!open) {
      throw new AppError(409, 'asset_not_assigned', 'Nobody is holding this asset.');
    }

    // Where it lands has to be somewhere the workspace says an asset can come
    // back to — a real status is not enough, or a device would return straight
    // into Ordered.
    const target = await requireStatus(tx, input.newStatus, 'newStatus');
    if (!target.checkinTarget) {
      throw invalidFields({
        newStatus: `${target.label} is not one of the statuses an asset can be checked in to.`,
      });
    }
    if (input.returnDate < open.checkedOutAt) {
      throw invalidFields({
        returnDate: `This asset was checked out on ${open.checkedOutAt}.`,
      });
    }

    // The holder's own status is what makes a return an offboarding return.
    const holder = open.employeeId
      ? await tx.select().from(employees).where(eq(employees.id, open.employeeId)).get()
      : undefined;
    // A deleted holder leaves employee_id NULL, and "no holder to offboard" is
    // exactly what deriveOutcome's null arm means.
    const outcome = deriveOutcome({
      holderStatus: holder ? (holder.status as EmployeeStatus) : null,
      newStatus: input.newStatus,
    });

    await closeAssignment(
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
    await writeAudit(
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
          // The label at write time, like `holderName` beside it: a status
          // renamed next year must not rewrite this sentence.
          to: target.label,
          condition: input.condition ?? null,
        },
      },
      now,
    );

    return serializeAsset(
      (await tx.select().from(assets).where(eq(assets.id, assetId)).get())!,
      null,
    );
  });
}
