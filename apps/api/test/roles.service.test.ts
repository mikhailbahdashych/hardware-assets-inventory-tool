import { eq } from 'drizzle-orm';
import { ACTIONS, DEFAULT_ROLES, MAX_ROLES } from '@inventory/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { auditEvents, members, rolePermissions } from '@/db/schema.js';
import type { RoleActor } from '@/types/roles.js';
import {
  createRole,
  deleteRole,
  listRoles,
  reorderRoles,
  replacePermissions,
  requireRole,
  resolvePermissions,
  updateRole,
} from '@/services/roles.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const MANAGER_GRANTS = DEFAULT_ROLES.find((role) => role.id === 'manager')!.grants;

/**
 * A real member, because every mutation writes an audit row and
 * `audit_events.actor_member_id` is a foreign key. The service tests call the
 * functions directly — several of these guards sit under an affordance the web
 * never draws, and they are the backstop for the day something draws it.
 */
async function admin(): Promise<{ cookie: string; actor: RoleActor }> {
  const cookie = await setupOrg(ctx.app);
  const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
  const member = me.json().member as { id: string; displayName: string };
  return { cookie, actor: { id: member.id, displayName: member.displayName, role: 'admin' } };
}

/** A member holding whatever role, so member counts and migration have subjects. */
function addMember(role: string, status: 'active' | 'invited' = 'active'): string {
  const id = `member-${role}-${status}-${Math.random().toString(16).slice(2, 8)}`;
  ctx.db
    .insert(members)
    .values({
      id,
      email: `${id}@acme.io`,
      displayName: `${role} person`,
      passwordHash: status === 'active' ? 'not-used' : null,
      role,
      status,
      createdAt: '2026-08-18T09:00:00.000Z',
      updatedAt: '2026-08-18T09:00:00.000Z',
    })
    .run();
  return id;
}

/**
 * A 422 carries its detail in `fields`, not in the message — the envelope's
 * message is always "Please correct the highlighted fields." — so these
 * assertions read the field the form would highlight.
 */
function fieldErrors(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    const fields = (error as { fields?: Record<string, string> }).fields;
    if (!fields) {
      throw new Error(`expected field errors, got: ${(error as Error).message}`, { cause: error });
    }
    return fields;
  }
  throw new Error('expected a throw, got a return');
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
  throw new Error('expected a throw, got a return');
}

const events = (action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, action))
    .all()
    .map((row) => ({ ...row, params: JSON.parse(row.params) as Record<string, unknown> }));

const auditor = (actor: RoleActor) =>
  createRole(ctx.deps, actor, {
    label: 'Auditor',
    description: 'Reads the books',
    color: 'warn',
  });

describe('reading the roles', () => {
  it('answers the seeded roles in sort order, with the permissions each resolves to', async () => {
    ctx = await buildTestApp();
    const rows = listRoles(ctx.db);

    expect(rows.map((role) => role.id)).toEqual(['admin', 'manager', 'viewer']);
    expect(rows[0]).toMatchObject({
      id: 'admin',
      label: 'Admin',
      description: 'Full access — settings, members, activity log',
      color: 'acc',
      isSystem: true,
      sortOrder: 0,
      memberCount: 0,
    });
    // The system role's set is every action there is, this build's included.
    expect([...rows[0]!.permissions].sort()).toEqual([...ACTIONS].sort());
    expect([...rows[1]!.permissions].sort()).toEqual([...MANAGER_GRANTS].sort());
    expect(rows[2]!.permissions).toEqual([]);
  });

  it('counts every member holding a role, invited ones included', async () => {
    ctx = await buildTestApp();
    addMember('manager');
    addMember('manager', 'invited');
    addMember('viewer');

    const counts = Object.fromEntries(listRoles(ctx.db).map((role) => [role.id, role.memberCount]));

    // An invitation nobody has accepted is still somebody who would be moved
    // by a delete, so it counts here exactly as it counts there.
    expect(counts).toEqual({ admin: 0, manager: 2, viewer: 1 });
  });

  it('resolves a role to a set the request path can ask one question of', async () => {
    ctx = await buildTestApp();

    expect([...resolvePermissions(ctx.db, 'admin')].sort()).toEqual([...ACTIONS].sort());
    expect(resolvePermissions(ctx.db, 'admin').has('roles.manage')).toBe(true);
    expect([...resolvePermissions(ctx.db, 'manager')].sort()).toEqual([...MANAGER_GRANTS].sort());
    expect(resolvePermissions(ctx.db, 'viewer').size).toBe(0);
    // Fail closed: a member whose role row is gone can do nothing at all.
    expect(resolvePermissions(ctx.db, 'nowhere').size).toBe(0);
  });

  it('ignores a stored grant naming an action this build no longer declares', async () => {
    ctx = await buildTestApp();
    ctx.db.insert(rolePermissions).values({ roleId: 'viewer', action: 'assets.teleport' }).run();

    expect(resolvePermissions(ctx.db, 'viewer').size).toBe(0);
    expect(listRoles(ctx.db).find((role) => role.id === 'viewer')!.permissions).toEqual([]);
  });

  it('hands back a role row or a field error naming the field that carried it', async () => {
    ctx = await buildTestApp();

    expect(requireRole(ctx.db, 'manager').label).toBe('Manager');
    expect(fieldErrors(() => requireRole(ctx.db, 'nowhere')).role).toMatch(/nowhere/);
    expect(fieldErrors(() => requireRole(ctx.db, 'nowhere', 'migrateTo')).migrateTo).toMatch(
      /nowhere/,
    );
  });
});

describe('creating a role', () => {
  it('slugs the label, lands it last, grants it nothing, and audits it', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const created = auditor(actor);

    expect(created).toMatchObject({
      id: 'auditor',
      label: 'Auditor',
      description: 'Reads the books',
      color: 'warn',
      isSystem: false,
      sortOrder: 3,
      memberCount: 0,
      permissions: [],
    });
    expect(listRoles(ctx.db).at(-1)!.id).toBe('auditor');
    expect(events('role.created')).toMatchObject([
      { type: 'auth', actorMemberId: actor.id, params: { label: 'Auditor' } },
    ]);
  });

  it('refuses a label that leaves no slug, and one that is already taken', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(
      fieldErrors(() => createRole(ctx.deps, actor, { label: '—', description: null, color: 'ok' }))
        .label,
    ).toMatch(/letters or numbers/i);
    // Case-insensitively taken, and taken as a slug: "Read Only" is read_only.
    expect(
      fieldErrors(() =>
        createRole(ctx.deps, actor, { label: 'manager', description: null, color: 'ok' }),
      ).label,
    ).toMatch(/already exists/i);

    expect(listRoles(ctx.db)).toHaveLength(3);
    expect(events('role.created')).toEqual([]);
  });

  it('stops at the cap, because the matrix has to stay readable', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    for (let index = 3; index < MAX_ROLES; index += 1) {
      createRole(ctx.deps, actor, { label: `Role ${index}`, description: null, color: 'neut' });
    }
    expect(listRoles(ctx.db)).toHaveLength(MAX_ROLES);

    expect(
      errorCode(() =>
        createRole(ctx.deps, actor, { label: 'One too many', description: null, color: 'neut' }),
      ),
    ).toBe('role_limit');
  });
});

describe('editing a role', () => {
  it('renames, recolors and redescribes without touching the id members carry', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    addMember('viewer');

    const updated = updateRole(ctx.deps, actor, 'viewer', {
      label: 'Read only',
      color: 'info',
      description: null,
    });

    expect(updated).toMatchObject({ id: 'viewer', label: 'Read only', color: 'info' });
    expect(updated.description).toBeNull();
    expect(ctx.db.select().from(members).all().at(-1)!.role).toBe('viewer');
    expect(events('role.updated')).toMatchObject([
      { params: { label: 'Read only', changedFields: ['label', 'description', 'color'] } },
    ]);
  });

  it('writes nothing at all when the patch changes nothing', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    updateRole(ctx.deps, actor, 'viewer', { label: 'Viewer', color: 'neut' });

    expect(events('role.updated')).toEqual([]);
  });

  it('refuses the system role — it is what keeps the workspace recoverable', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(errorCode(() => updateRole(ctx.deps, actor, 'admin', { label: 'Owner' }))).toBe(
      'system_role',
    );
    expect(listRoles(ctx.db)[0]!.label).toBe('Admin');
  });

  it('refuses the role the caller holds, however they came by the permission', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    const wearer: RoleActor = { id: actor.id, displayName: actor.displayName, role: 'auditor' };

    expect(errorCode(() => updateRole(ctx.deps, wearer, 'auditor', { label: 'Inspector' }))).toBe(
      'own_role',
    );
    // Somebody else's role is still theirs to edit.
    expect(updateRole(ctx.deps, wearer, 'viewer', { label: 'Read only' }).label).toBe('Read only');
  });

  it('refuses a rename onto another role’s name', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(
      fieldErrors(() => updateRole(ctx.deps, actor, 'viewer', { label: 'manager' })).label,
    ).toMatch(/already exists/i);
    // Its own name, in its own case, is not a collision.
    expect(updateRole(ctx.deps, actor, 'viewer', { label: 'Viewer' }).label).toBe('Viewer');
  });
});

describe('replacing the grant set', () => {
  it('stores exactly what it is given, deduped, and audits the difference', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const counts = replacePermissions(ctx.deps, actor, {
      grants: [
        { role: 'viewer', action: 'audit.view' },
        { role: 'viewer', action: 'audit.view' },
        { role: 'manager', action: 'assets.create' },
      ],
    });

    // Viewer gains one; Manager keeps one of nine and loses the other eight.
    expect(counts).toEqual({ added: 1, removed: 8 });
    expect([...resolvePermissions(ctx.db, 'viewer')]).toEqual(['audit.view']);
    expect([...resolvePermissions(ctx.db, 'manager')]).toEqual(['assets.create']);
    expect(events('role.permissions_changed')).toMatchObject([
      { type: 'auth', params: { added: 1, removed: 8 } },
    ]);
  });

  it('writes nothing when the matrix is resubmitted unchanged', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const grants = MANAGER_GRANTS.map((action) => ({ role: 'manager', action }));

    expect(replacePermissions(ctx.deps, actor, { grants })).toEqual({ added: 0, removed: 0 });
    expect(events('role.permissions_changed')).toEqual([]);
  });

  it('refuses a grant naming the system role or a role that does not exist', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const attempt = (role: string) =>
      fieldErrors(() =>
        replacePermissions(ctx.deps, actor, { grants: [{ role, action: 'audit.view' }] }),
      ).grants;

    expect(attempt('admin')).toMatch(/every permission/i);
    expect(attempt('nowhere')).toMatch(/nowhere/);
    // Nothing half-applied: Manager still holds everything it was seeded with.
    expect(resolvePermissions(ctx.db, 'manager').size).toBe(MANAGER_GRANTS.length);
  });

  it('refuses a save that would change what the caller’s own role may do', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    replacePermissions(ctx.deps, actor, { grants: [{ role: 'auditor', action: 'audit.view' }] });
    const wearer: RoleActor = { id: actor.id, displayName: actor.displayName, role: 'auditor' };

    expect(
      errorCode(() =>
        replacePermissions(ctx.deps, wearer, {
          grants: [
            { role: 'auditor', action: 'audit.view' },
            { role: 'auditor', action: 'workspace.delete' },
          ],
        }),
      ),
    ).toBe('own_role');
    // Their own column, submitted unchanged, is not a change — the whole
    // matrix is sent on every save, so it always carries their column.
    expect(
      replacePermissions(ctx.deps, wearer, {
        grants: [
          { role: 'auditor', action: 'audit.view' },
          { role: 'viewer', action: 'export.run' },
        ],
      }),
    ).toEqual({ added: 1, removed: 0 });
  });
});

describe('reordering roles', () => {
  it('takes a permutation and renumbers every row', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    reorderRoles(ctx.deps, actor, ['viewer', 'admin', 'manager']);

    const rows = listRoles(ctx.db);
    expect(rows.map((role) => role.id)).toEqual(['viewer', 'admin', 'manager']);
    expect(rows.map((role) => role.sortOrder)).toEqual([0, 1, 2]);
    expect(events('role.reordered')).toHaveLength(1);
  });

  it('refuses a list that is not every role exactly once', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const attempt = (sent: string[]) =>
      fieldErrors(() => reorderRoles(ctx.deps, actor, sent)).order;

    expect(attempt(['admin', 'manager'])).toMatch(/exactly once/i);
    expect(attempt(['admin', 'manager', 'manager'])).toMatch(/exactly once/i);
    expect(attempt(['admin', 'manager', 'nowhere'])).toMatch(/exactly once/i);

    expect(listRoles(ctx.db).map((role) => role.id)).toEqual(['admin', 'manager', 'viewer']);
  });
});

describe('deleting a role', () => {
  it('takes an unused role and its grants with it', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    replacePermissions(ctx.deps, actor, { grants: [{ role: 'auditor', action: 'audit.view' }] });

    deleteRole(ctx.deps, actor, 'auditor');

    expect(listRoles(ctx.db).map((role) => role.id)).not.toContain('auditor');
    expect(ctx.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, 'auditor')).all()).toEqual([]); // prettier-ignore
    expect(events('role.deleted')).toMatchObject([
      { type: 'auth', params: { label: 'Auditor', migratedToLabel: null, memberCount: 0 } },
    ]);
  });

  it('refuses the system role and the role the caller holds', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    const wearer: RoleActor = { id: actor.id, displayName: actor.displayName, role: 'auditor' };

    expect(errorCode(() => deleteRole(ctx.deps, actor, 'admin'))).toBe('system_role');
    expect(errorCode(() => deleteRole(ctx.deps, wearer, 'auditor'))).toBe('own_role');
    expect(listRoles(ctx.db)).toHaveLength(4);
  });

  it('says how many members are in the way, and moves them when told where', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    const active = addMember('auditor');
    const invited = addMember('auditor', 'invited');

    expect(errorCode(() => deleteRole(ctx.deps, actor, 'auditor'))).toBe('role_in_use');
    expect(() => deleteRole(ctx.deps, actor, 'auditor')).toThrow(/2 members/);
    expect(listRoles(ctx.db).map((role) => role.id)).toContain('auditor');

    deleteRole(ctx.deps, actor, 'auditor', 'viewer');

    const moved = ctx.db.select().from(members).all();
    // An invitation nobody accepted moves with everybody else — it is a member
    // row, and leaving it pointing at a role that is gone is how a workspace
    // ends up with somebody who can do nothing.
    expect(moved.find((row) => row.id === active)!.role).toBe('viewer');
    expect(moved.find((row) => row.id === invited)!.role).toBe('viewer');
    expect(listRoles(ctx.db).map((role) => role.id)).not.toContain('auditor');
    // One summary event, not one per member.
    expect(events('role.deleted')).toMatchObject([
      { params: { label: 'Auditor', migratedToLabel: 'Viewer', memberCount: 2 } },
    ]);
  });

  it('refuses a destination that is missing or is the role being deleted', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    addMember('auditor');

    const attempt = (migrateTo: string) =>
      fieldErrors(() => deleteRole(ctx.deps, actor, 'auditor', migrateTo)).migrateTo;
    expect(attempt('nowhere')).toMatch(/nowhere/);
    expect(attempt('auditor')).toMatch(/different role/i);

    expect(ctx.db.select().from(members).all().at(-1)!.role).toBe('auditor');
    expect(listRoles(ctx.db)).toHaveLength(4);
  });

  it('lets the destination be Admin, because that is a choice somebody may mean', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    auditor(actor);
    const member = addMember('auditor');

    deleteRole(ctx.deps, actor, 'auditor', 'admin');

    expect(ctx.db.select().from(members).all().find((row) => row.id === member)!.role).toBe('admin'); // prettier-ignore
    expect(events('role.deleted')).toMatchObject([
      { params: { migratedToLabel: 'Admin', memberCount: 1 } },
    ]);
  });
});
