import { asc, eq, sql } from 'drizzle-orm';
import {
  ACTIONS,
  MAX_ROLES,
  roleSlug,
  type Action,
  type PermissionsPutInput,
  type RoleCreateInput,
  type RolePatchInput,
  type SemanticColor,
  type WorkspaceRole,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { DbOrTx } from '@/types/db.js';
import type { RoleActor, RoleRow } from '@/types/roles.js';
import { members, rolePermissions, roles } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { writeAudit } from './audit.js';

/**
 * Every rule about roles and what they may do, in one place. `members.role` has
 * no foreign key and the tables carry no CHECK constraints — deliberate, and
 * what makes this file load-bearing: the request path asks it what a member may
 * do rather than deciding for itself, so there is one answer and one place to
 * change it.
 *
 * Three invariants outrank everything here. Admin is the **system role**: its
 * permission set is `ACTIONS` by definition rather than rows, so an action
 * added in a future version is already its own, and it can be neither edited
 * nor deleted — it is what keeps a workspace administrable, the same shape of
 * guard as the last admin. **Nobody may change the role they hold**, which
 * closes quiet self-promotion by anybody granted `roles.manage`. And **a role
 * with members cannot simply vanish**: the delete says how many hold it and
 * moves them all in the transaction that removes the row.
 */

/** Actions this build declares. A stored grant outside it is a leftover. */
const KNOWN_ACTIONS = new Set<string>(ACTIONS);

const serialize = (row: RoleRow, memberCount: number, permissions: Action[]): WorkspaceRole => ({
  id: row.id,
  label: row.label,
  description: row.description,
  // The column is TEXT with no CHECK, exactly like every other enum in this
  // database; the zod contract on the way in is what keeps it one of the six.
  color: row.color as SemanticColor,
  isSystem: row.isSystem,
  sortOrder: row.sortOrder,
  memberCount,
  permissions,
});

const roleRows = async (db: DbOrTx): Promise<RoleRow[]> =>
  await db.select().from(roles).orderBy(asc(roles.sortOrder)).all();

/**
 * Members per role id, invited ones included — an invitation nobody has
 * accepted is still somebody a delete has to move.
 */
async function memberCounts(db: DbOrTx): Promise<Map<string, number>> {
  const rows = await db
    .select({ role: members.role, count: sql<number>`count(*)` })
    .from(members)
    .groupBy(members.role)
    .all();
  return new Map(rows.map((row) => [row.role, row.count]));
}

/** Stored grants per role id, with anything this build dropped filtered out. */
async function grantsByRole(db: DbOrTx): Promise<Map<string, Action[]>> {
  const grouped = new Map<string, Action[]>();
  for (const row of await db.select().from(rolePermissions).all()) {
    if (!isKnownAction(row.action)) continue;
    const actions = grouped.get(row.roleId);
    if (actions) actions.push(row.action);
    else grouped.set(row.roleId, [row.action]);
  }
  return grouped;
}

function isKnownAction(action: string): action is Action {
  return KNOWN_ACTIONS.has(action);
}

/** Every role, as `GET /api/v1/roles` and the Roles page read them. */
export async function listRoles(db: DbOrTx): Promise<WorkspaceRole[]> {
  const counts = await memberCounts(db);
  const grants = await grantsByRole(db);
  return (await roleRows(db)).map((row) =>
    serialize(
      row,
      // A role nobody holds is absent from the grouped count, and absent
      // there means zero — the query counts rows, so it cannot mean anything
      // else. Same for a role with no grants.
      counts.get(row.id) ?? 0,
      row.isSystem ? [...ACTIONS] : (grants.get(row.id) ?? []),
    ),
  );
}

/**
 * What a member holding this role may do, resolved per request.
 *
 * The system role answers `ACTIONS` **by definition** rather than from rows:
 * that one line is what makes "every action, including the ones a future
 * version adds" true with no reconciliation at boot.
 *
 * An unknown role id answers the empty set — fail closed. It is unreachable in
 * practice, because deleting a role moves every member holding it in the same
 * transaction, but "the role is gone" must never read as "anything goes".
 */
export async function resolvePermissions(db: DbOrTx, roleId: string): Promise<ReadonlySet<Action>> {
  const row = await db.select().from(roles).where(eq(roles.id, roleId)).get();
  if (!row) return new Set();
  if (row.isSystem) return new Set(ACTIONS);
  return new Set(
    (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId)).all())
      .map((grant) => grant.action)
      .filter(isKnownAction),
  );
}

/**
 * The role a slug names, or a 422 pointing at the field that carried it. Which
 * field matters: a bad `role` on the invite form and a bad `migrateTo` in the
 * delete dialog must highlight different inputs.
 */
export async function requireRole(db: DbOrTx, id: string, field = 'role'): Promise<RoleRow> {
  const row = await db.select().from(roles).where(eq(roles.id, id)).get();
  if (!row) throw invalidFields({ [field]: `"${id}" is not a role in this workspace.` });
  return row;
}

export async function createRole(
  deps: AppDeps,
  actor: RoleActor,
  input: RoleCreateInput,
): Promise<WorkspaceRole> {
  const now = deps.now();
  const at = nowIso(now);

  return await deps.db.transaction(async (tx) => {
    const existing = await roleRows(tx);
    if (existing.length >= MAX_ROLES) {
      throw new AppError(
        409,
        'role_limit',
        `A workspace can hold ${MAX_ROLES} roles. Delete one before adding another.`,
      );
    }

    const id = roleSlug(input.label);
    if (!id) {
      throw invalidFields({ label: 'Give the role a name with letters or numbers in it.' });
    }
    assertLabelFree(existing, id, input.label);

    // Last in the list: a role somebody just added has no claim on a place
    // among the ones they arranged.
    const sortOrder = existing.reduce((highest, row) => Math.max(highest, row.sortOrder), -1) + 1;
    await tx
      .insert(roles)
      .values({
        id,
        label: input.label,
        description: input.description,
        color: input.color,
        isSystem: false,
        sortOrder,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    // No permission rows at all: the matrix is where granting happens, and a
    // new role that could already do things is a role nobody decided on.
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'role.created',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { label: input.label },
      },
      now,
    );

    return serialize(await requireRole(tx, id), 0, []);
  });
}

export async function updateRole(
  deps: AppDeps,
  actor: RoleActor,
  id: string,
  patch: RolePatchInput,
): Promise<WorkspaceRole> {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const rows = await roleRows(tx);
    const current = rows.find((row) => row.id === id);
    if (!current) throw notFound('That role');
    assertEditable(current, actor);

    const values: Partial<RoleRow> = {};
    const changedFields: string[] = [];
    if (patch.label !== undefined && patch.label !== current.label) {
      assertLabelFree(
        rows.filter((row) => row.id !== id),
        roleSlug(patch.label),
        patch.label,
      );
      values.label = patch.label;
      changedFields.push('label');
    }
    // A present null is the design's "no description"; absent leaves it alone.
    if (patch.description !== undefined && patch.description !== current.description) {
      values.description = patch.description;
      changedFields.push('description');
    }
    if (patch.color !== undefined && patch.color !== current.color) {
      values.color = patch.color;
      changedFields.push('color');
    }

    // An unchanged submit writes nothing at all, exactly like PATCH /settings.
    if (changedFields.length === 0) return readRole(tx, current);

    values.updatedAt = nowIso(now);
    await tx.update(roles).set(values).where(eq(roles.id, id)).run();
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'role.updated',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        // The label *after* the patch, like every other update event.
        params: { label: values.label ?? current.label, changedFields },
      },
      now,
    );

    return await readRole(tx, await requireRole(tx, id));
  });
}

/**
 * The matrix's Save: every non-system role's grants, replaced. Sending
 * everything is what a grid of checkboxes naturally holds, and it makes the
 * operation idempotent — two admins saving the same matrix land on the same
 * permissions. Only the difference is written, so a save that changes one box
 * touches one row.
 */
export async function replacePermissions(
  deps: AppDeps,
  actor: RoleActor,
  input: PermissionsPutInput,
): Promise<{ added: number; removed: number }> {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const known = new Map((await roleRows(tx)).map((row) => [row.id, row]));

    // Deduped silently: a matrix cannot check a box twice, and a client that
    // repeats a grant is asking for the same permissions either way.
    const wanted = new Set<string>();
    for (const grant of input.grants) {
      const role = known.get(grant.role);
      if (!role) {
        throw invalidFields({ grants: `"${grant.role}" is not a role in this workspace.` });
      }
      if (role.isSystem) {
        throw invalidFields({
          grants: `${role.label} holds every permission there is, including the ones a future version adds.`,
        });
      }
      wanted.add(key(grant.role, grant.action));
    }

    const stored = new Set(
      (await tx.select().from(rolePermissions).all()).map((row) => key(row.roleId, row.action)),
    );
    const added = [...wanted].filter((pair) => !stored.has(pair));
    const removed = [...stored].filter((pair) => !wanted.has(pair));

    // The same rule as PATCH and DELETE, applied to a cell rather than a row:
    // granting yourself a permission is the promotion this feature is careful
    // not to allow. Their own column arrives on every save, so it is compared
    // rather than refused — unchanged is not a change.
    const ownPrefix = `${actor.role}:`;
    if ([...added, ...removed].some((pair) => pair.startsWith(ownPrefix))) {
      throw new AppError(
        409,
        'own_role',
        'You cannot change what your own role may do — ask another admin.',
      );
    }

    if (added.length === 0 && removed.length === 0) return { added: 0, removed: 0 };

    for (const pair of added) {
      const [roleId, action] = split(pair);
      await tx.insert(rolePermissions).values({ roleId, action }).run();
    }
    for (const pair of removed) {
      const [roleId, action] = split(pair);
      await tx
        .delete(rolePermissions)
        .where(sql`${rolePermissions.roleId} = ${roleId} and ${rolePermissions.action} = ${action}`)
        .run();
    }
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'role.permissions_changed',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { added: added.length, removed: removed.length },
      },
      now,
    );

    return { added: added.length, removed: removed.length };
  });
}

/** Up and down arrows send the whole list, so the result is always coherent. */
export async function reorderRoles(
  deps: AppDeps,
  actor: RoleActor,
  order: string[],
): Promise<void> {
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    const rows = await roleRows(tx);
    const known = new Set(rows.map((row) => row.id));
    const sent = new Set(order);
    if (
      order.length !== rows.length ||
      sent.size !== order.length ||
      ![...sent].every((id) => known.has(id))
    ) {
      throw invalidFields({ order: 'Send every role id exactly once.' });
    }

    // The system role takes part like any other row: where it sits is
    // presentation, and nothing depends on it being first.
    const at = nowIso(now);
    for (const [sortOrder, id] of order.entries()) {
      await tx.update(roles).set({ sortOrder, updatedAt: at }).where(eq(roles.id, id)).run();
    }
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'role.reordered',
        actorMemberId: actor.id,
        actorName: actor.displayName,
      },
      now,
    );
  });
}

/**
 * Deleting a role is the one operation that can move every member at once, so
 * it is a single transaction: the members move, the row goes (its grants
 * cascade), and one summary event records how many moved — not one per member,
 * which would bury the rest of the log.
 */
export async function deleteRole(
  deps: AppDeps,
  actor: RoleActor,
  id: string,
  migrateTo?: string,
): Promise<void> {
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    const current = await tx.select().from(roles).where(eq(roles.id, id)).get();
    if (!current) throw notFound('That role');
    assertEditable(current, actor);

    const holders = await tx
      .select({ count: sql<number>`count(*)` })
      .from(members)
      .where(eq(members.role, id))
      .get();
    // count(*) over a table that exists always answers a row; a miss here
    // would be a broken query rather than an empty workspace.
    if (!holders) throw new AppError(500, 'count_failed', 'The member count did not answer.');
    const memberCount = holders.count;

    let destination: RoleRow | null = null;
    if (memberCount > 0) {
      if (migrateTo === undefined) {
        throw new AppError(
          409,
          'role_in_use',
          `${memberCount} ${memberCount === 1 ? 'member holds' : 'members hold'} this role. Choose which role to move them to first.`,
        );
      }
      destination = await requireMigrationTarget(tx, id, migrateTo);
      await tx
        .update(members)
        .set({ role: destination.id, updatedAt: nowIso(now) })
        .where(eq(members.role, id))
        .run();
    } else if (migrateTo !== undefined) {
      // Nobody to move, but a destination the admin cannot have meant is still
      // worth saying out loud rather than silently ignoring.
      destination = await requireMigrationTarget(tx, id, migrateTo);
    }

    await tx.delete(roles).where(eq(roles.id, id)).run();
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'role.deleted',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: {
          label: current.label,
          // Null rather than absent: "deleted, nobody to move" is a real
          // answer, and the renderer says a different sentence for it.
          migratedToLabel: destination?.label ?? null,
          memberCount,
        },
      },
      now,
    );
  });
}

/** One role with the counts and permissions the page reads it with. */
async function readRole(tx: DbOrTx, row: RoleRow): Promise<WorkspaceRole> {
  const counts = await memberCounts(tx);
  return serialize(
    row,
    counts.get(row.id) ?? 0,
    row.isSystem
      ? [...ACTIONS]
      : (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, row.id)).all())
          .map((grant) => grant.action)
          .filter(isKnownAction),
  );
}

/**
 * The two rows nobody may touch: the system role, because it is what keeps a
 * workspace administrable, and the caller's own, because self-promotion is the
 * thing granular permissions would otherwise make quiet and easy. Checked in
 * that order — "Admin cannot be changed" is the truer sentence about the Admin
 * row, whoever is asking.
 */
function assertEditable(row: RoleRow, actor: RoleActor): void {
  if (row.isSystem) {
    throw new AppError(
      409,
      'system_role',
      `The ${row.label} role is what keeps the workspace recoverable — it cannot be changed.`,
    );
  }
  if (row.id === actor.role) {
    throw new AppError(409, 'own_role', 'You cannot change the role you hold — ask another admin.');
  }
}

/**
 * Two roles one letter apart are two ways to be surprised by what somebody may
 * do, so names are compared case-insensitively — and the slug is checked too,
 * because "Read Only" and "read only" are one row's identity either way.
 */
function assertLabelFree(rows: RoleRow[], slug: string, label: string): void {
  const wanted = label.trim().toLowerCase();
  const clash = rows.some((row) => row.id === slug || row.label.trim().toLowerCase() === wanted);
  if (clash) throw invalidFields({ label: 'A role with that name already exists.' });
}

/**
 * Where the members of a deleted role go. Never itself; Admin is allowed,
 * because promoting the last two people in a department is a choice somebody
 * may genuinely mean.
 */
async function requireMigrationTarget(tx: DbOrTx, id: string, migrateTo: string): Promise<RoleRow> {
  if (migrateTo === id) {
    throw invalidFields({ migrateTo: 'Choose a different role to move these members to.' });
  }
  return await requireRole(tx, migrateTo, 'migrateTo');
}

/**
 * One grant as a comparable string. Role ids are slugs, so they never contain a
 * colon and the pair always splits back into exactly two halves.
 */
const key = (role: string, action: string): string => `${role}:${action}`;

function split(pair: string): [string, string] {
  const index = pair.indexOf(':');
  // Built by `key` above, which always writes one: an index of -1 would mean
  // a string that never came from there.
  return [pair.slice(0, index), pair.slice(index + 1)];
}
