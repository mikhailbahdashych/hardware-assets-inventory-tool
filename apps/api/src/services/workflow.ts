import { and, asc, count, eq } from 'drizzle-orm';
import {
  ASSIGNED_STATUS,
  MAX_ASSET_STATUSES,
  statusSlug,
  type SemanticColor,
  type StatusCreateInput,
  type StatusPatchInput,
  type TransitionsPutInput,
  type WorkflowPayload,
  type WorkflowStatus,
  type WorkflowTransition,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Actor } from '@/types/audit.js';
import type { DbOrTx } from '@/types/db.js';
import type { AssetStatusRow } from '@/types/workflow.js';
import { assets, assetStatuses, assetStatusTransitions } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { writeAudit } from './audit.js';

/**
 * Every rule about statuses and the moves between them, in one place. The
 * tables carry no CHECK constraints and `assets.status` has no foreign key —
 * that is deliberate, and it is what makes this file load-bearing: the assets
 * and assignments services ask it what is legal rather than deciding for
 * themselves, so there is one answer and one place to change it.
 *
 * Two invariants outrank everything here. `assigned` is a system status that
 * only assign and check-in may enter or leave, which is what keeps
 * `assets.status = 'assigned'` ⇔ an open ownership row true. And a workspace
 * may never lose its last assignable status or its last check-in target,
 * because either would make an operation the product is built around
 * impossible — the same shape of guard as the last admin.
 */

const serialize = (row: AssetStatusRow): WorkflowStatus => ({
  id: row.id,
  label: row.label,
  // The column is TEXT with no CHECK, exactly like every other enum in this
  // database; the zod contract on the way in is what keeps it one of the six.
  color: row.color as SemanticColor,
  isSystem: row.isSystem,
  assignableFrom: row.assignableFrom,
  checkinTarget: row.checkinTarget,
  sortOrder: row.sortOrder,
});

const statusRows = async (db: DbOrTx): Promise<AssetStatusRow[]> =>
  await db.select().from(assetStatuses).orderBy(asc(assetStatuses.sortOrder));

const edgeRows = async (db: DbOrTx): Promise<WorkflowTransition[]> =>
  (
    await db
      .select()
      .from(assetStatusTransitions)
      .orderBy(asc(assetStatusTransitions.fromStatus), asc(assetStatusTransitions.toStatus))
  ).map((row) => ({ from: row.fromStatus, to: row.toStatus }));

/** The whole workflow, as `GET /api/v1/workflow` and the services read it. */
export async function getWorkflow(db: DbOrTx): Promise<WorkflowPayload> {
  return { statuses: (await statusRows(db)).map(serialize), transitions: await edgeRows(db) };
}

/**
 * The status a slug names, or a 422 pointing at the field that carried it.
 * Which field matters: a bad `status` on an asset form and a bad `newStatus`
 * in the check-in modal must highlight different inputs.
 */
export async function requireStatus(
  db: DbOrTx,
  id: string,
  field = 'status',
): Promise<AssetStatusRow> {
  const [row] = await db.select().from(assetStatuses).where(eq(assetStatuses.id, id));
  if (!row) throw invalidFields({ [field]: `"${id}" is not a status in this workspace.` });
  return row;
}

/** Whether the graph has this edge. Nothing else decides a direct move. */
export async function transitionAllowed(db: DbOrTx, from: string, to: string): Promise<boolean> {
  const edges = await db
    .select()
    .from(assetStatusTransitions)
    .where(
      and(eq(assetStatusTransitions.fromStatus, from), eq(assetStatusTransitions.toStatus, to)),
    );
  return edges.length > 0;
}

/** The statuses an asset may be handed out from, in the workspace's order. */
export async function assignableStatuses(db: DbOrTx): Promise<AssetStatusRow[]> {
  return await db
    .select()
    .from(assetStatuses)
    .where(eq(assetStatuses.assignableFrom, true))
    .orderBy(asc(assetStatuses.sortOrder));
}

export async function createStatus(
  deps: AppDeps,
  actor: Actor,
  input: StatusCreateInput,
): Promise<WorkflowStatus> {
  const now = deps.now();
  const at = nowIso(now);

  return await deps.db.transaction(async (tx) => {
    const existing = await statusRows(tx);
    if (existing.length >= MAX_ASSET_STATUSES) {
      throw new AppError(
        409,
        'too_many_statuses',
        `A workspace can hold ${MAX_ASSET_STATUSES} statuses. Delete one before adding another.`,
      );
    }

    const id = statusSlug(input.label);
    if (!id) {
      throw invalidFields({ label: 'Give the status a name with letters or numbers in it.' });
    }
    assertLabelFree(existing, id, input.label);

    // Last in the list, like a new custom field: a status the admin just added
    // has no claim on a place among the ones they arranged.
    const sortOrder = existing.reduce((highest, row) => Math.max(highest, row.sortOrder), -1) + 1;
    await tx.insert(assetStatuses).values({
      id,
      label: input.label,
      color: input.color,
      isSystem: false,
      assignableFrom: input.assignableFrom,
      checkinTarget: input.checkinTarget,
      sortOrder,
      createdAt: at,
      updatedAt: at,
    });
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'workflow.status_created',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { label: input.label },
      },
      now,
    );

    return serialize(await requireStatus(tx, id));
  });
}

export async function updateStatus(
  deps: AppDeps,
  actor: Actor,
  id: string,
  patch: StatusPatchInput,
): Promise<WorkflowStatus> {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const rows = await statusRows(tx);
    const current = rows.find((row) => row.id === id);
    if (!current) throw notFound('That status');

    // A system status may be renamed and recolored — those are presentation.
    // Its flags are not: assign and check-in are the only doors into and out
    // of it, and a flag would open a second one.
    if (current.isSystem) {
      for (const flag of ['assignableFrom', 'checkinTarget'] as const) {
        if (patch[flag] !== undefined) {
          throw invalidFields({
            [flag]: `${current.label} is a system status — assign and check-in are its only doors.`,
          });
        }
      }
    }

    const values: Partial<AssetStatusRow> = {};
    const changedFields: string[] = [];
    if (patch.label !== undefined && patch.label !== current.label) {
      assertLabelFree(
        rows.filter((row) => row.id !== id),
        statusSlug(patch.label),
        patch.label,
      );
      values.label = patch.label;
      changedFields.push('label');
    }
    if (patch.color !== undefined && patch.color !== current.color) {
      values.color = patch.color;
      changedFields.push('color');
    }
    if (patch.assignableFrom !== undefined && patch.assignableFrom !== current.assignableFrom) {
      if (!patch.assignableFrom) assertNotLastAssignable(rows, id);
      values.assignableFrom = patch.assignableFrom;
      changedFields.push('assignableFrom');
    }
    if (patch.checkinTarget !== undefined && patch.checkinTarget !== current.checkinTarget) {
      if (!patch.checkinTarget) assertNotLastCheckinTarget(rows, id);
      values.checkinTarget = patch.checkinTarget;
      changedFields.push('checkinTarget');
    }

    // An unchanged submit writes nothing at all, exactly like PATCH /settings.
    if (changedFields.length === 0) return serialize(current);

    values.updatedAt = nowIso(now);
    await tx.update(assetStatuses).set(values).where(eq(assetStatuses.id, id));
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'workflow.status_updated',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        // The label *after* the patch, like every other update event.
        params: { label: values.label ?? current.label, changedFields },
      },
      now,
    );

    return serialize(await requireStatus(tx, id));
  });
}

/**
 * Deleting a status is the one operation that can touch every asset at once,
 * so it is a single transaction: the assets move, the row goes (its edges
 * cascade), and one summary event records how many moved — not one per asset,
 * which would bury the rest of the log after a bulk migration.
 */
export async function deleteStatus(
  deps: AppDeps,
  actor: Actor,
  id: string,
  migrateTo?: string,
): Promise<void> {
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    const rows = await statusRows(tx);
    const current = rows.find((row) => row.id === id);
    if (!current) throw notFound('That status');
    if (current.isSystem) {
      throw new AppError(
        409,
        'system_status',
        `${current.label} is a system status and cannot be deleted.`,
      );
    }
    if (current.assignableFrom) assertNotLastAssignable(rows, id);
    if (current.checkinTarget) assertNotLastCheckinTarget(rows, id);

    const [holders] = await tx.select({ count: count() }).from(assets).where(eq(assets.status, id));
    // count(*) over a table that exists always answers a row; a miss here
    // would be a broken query rather than an empty inventory.
    if (!holders) throw new AppError(500, 'count_failed', 'The status count did not answer.');
    const assetCount = holders.count;

    let destination: AssetStatusRow | null = null;
    if (assetCount > 0) {
      if (migrateTo === undefined) {
        throw new AppError(
          409,
          'status_in_use',
          `${assetCount} ${assetCount === 1 ? 'asset is' : 'assets are'} in this status. Choose where to move ${assetCount === 1 ? 'it' : 'them'} first.`,
        );
      }
      destination = await requireMigrationTarget(tx, id, migrateTo);
      await tx
        .update(assets)
        .set({ status: destination.id, updatedAt: nowIso(now) })
        .where(eq(assets.status, id));
    } else if (migrateTo !== undefined) {
      // Nothing to move, but a destination the admin cannot have meant is
      // still worth saying out loud rather than silently ignoring.
      destination = await requireMigrationTarget(tx, id, migrateTo);
    }

    await tx.delete(assetStatuses).where(eq(assetStatuses.id, id));
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'workflow.status_deleted',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: {
          label: current.label,
          // Null rather than absent: "deleted, nothing to move" is a real
          // answer, and the renderer says a different sentence for it.
          migratedToLabel: destination?.label ?? null,
          assetCount,
        },
      },
      now,
    );
  });
}

/**
 * The matrix's Save: the whole graph, replaced. Sending everything is what a
 * grid of checkboxes naturally holds, and it makes the operation idempotent —
 * two admins saving the same matrix land on the same graph.
 */
export async function replaceTransitions(
  deps: AppDeps,
  actor: Actor,
  input: TransitionsPutInput,
): Promise<WorkflowTransition[]> {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const known = new Set((await statusRows(tx)).map((row) => row.id));

    // Deduped silently: a matrix cannot check a box twice, and a client that
    // repeats an edge is asking for the same graph either way.
    const wanted = new Map<string, WorkflowTransition>();
    for (const edge of input.transitions) {
      for (const endpoint of [edge.from, edge.to]) {
        if (!known.has(endpoint)) {
          throw invalidFields({
            transitions: `"${endpoint}" is not a status in this workspace.`,
          });
        }
        if (endpoint === ASSIGNED_STATUS) {
          throw invalidFields({
            transitions:
              'Assigned is entered by assigning and left by checking in, never by a transition.',
          });
        }
      }
      if (edge.from === edge.to) {
        throw invalidFields({ transitions: 'A status cannot transition to itself.' });
      }
      wanted.set(`${edge.from}→${edge.to}`, { from: edge.from, to: edge.to });
    }

    const stored = new Set((await edgeRows(tx)).map((edge) => `${edge.from}→${edge.to}`));
    const added = [...wanted.keys()].filter((key) => !stored.has(key)).length;
    const removed = [...stored].filter((key) => !wanted.has(key)).length;

    if (added === 0 && removed === 0) return edgeRows(tx);

    await tx.delete(assetStatusTransitions);
    for (const edge of wanted.values()) {
      await tx.insert(assetStatusTransitions).values({ fromStatus: edge.from, toStatus: edge.to });
    }
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'workflow.transitions_updated',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { added, removed },
      },
      now,
    );

    return edgeRows(tx);
  });
}

/** Up and down arrows send the whole list, so the result is always coherent. */
export async function reorderStatuses(
  deps: AppDeps,
  actor: Actor,
  ids: string[],
): Promise<WorkflowStatus[]> {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const rows = await statusRows(tx);
    const known = new Set(rows.map((row) => row.id));
    const sent = new Set(ids);
    if (
      ids.length !== rows.length ||
      sent.size !== ids.length ||
      ![...sent].every((id) => known.has(id))
    ) {
      // prettier-ignore
      throw invalidFields({ ids: 'Send every status id exactly once.' });
    }

    const at = nowIso(now);
    for (const [sortOrder, id] of ids.entries()) {
      await tx.update(assetStatuses).set({ sortOrder, updatedAt: at }).where(eq(assetStatuses.id, id)); // prettier-ignore
    }
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'workflow.statuses_reordered',
        actorMemberId: actor.id,
        actorName: actor.displayName,
      },
      now,
    );

    return (await statusRows(tx)).map(serialize);
  });
}

/**
 * Two statuses one letter apart are two ways to lose track of the same asset,
 * so names are compared case-insensitively — and the slug is checked too,
 * because "In Repair" and "in repair" are one row's identity either way.
 */
function assertLabelFree(rows: AssetStatusRow[], slug: string, label: string): void {
  const wanted = label.trim().toLowerCase();
  const clash = rows.some((row) => row.id === slug || row.label.trim().toLowerCase() === wanted);
  if (clash) throw invalidFields({ label: 'A status with that name already exists.' });
}

/** Where assets in a deleted status go. Never `assigned`, never itself. */
async function requireMigrationTarget(
  tx: DbOrTx,
  id: string,
  migrateTo: string,
): Promise<AssetStatusRow> {
  if (migrateTo === id) {
    throw invalidFields({ migrateTo: 'Choose a different status to move these assets to.' });
  }
  if (migrateTo === ASSIGNED_STATUS) {
    throw invalidFields({ migrateTo: 'Assets are moved into Assigned by assigning them.' });
  }
  const [row] = await tx.select().from(assetStatuses).where(eq(assetStatuses.id, migrateTo));
  if (!row) throw invalidFields({ migrateTo: 'That status could not be found.' });
  return row;
}

function assertNotLastAssignable(rows: AssetStatusRow[], id: string): void {
  const others = rows.filter((row) => row.id !== id && row.assignableFrom);
  if (others.length === 0) {
    throw new AppError(
      409,
      'workflow_needs_assignable',
      'At least one status has to be one assets can be handed out from.',
    );
  }
}

function assertNotLastCheckinTarget(rows: AssetStatusRow[], id: string): void {
  const others = rows.filter((row) => row.id !== id && row.checkinTarget);
  if (others.length === 0) {
    throw new AppError(
      409,
      'workflow_needs_checkin_target',
      'At least one status has to be one an asset can be checked in to.',
    );
  }
}
