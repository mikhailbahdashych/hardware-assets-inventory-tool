import { ACTIONS } from '@inventory/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { members } from '@/db/schema.js';
import { listRoles } from '@/services/roles.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

describe('GET /api/v1/roles', () => {
  it('needs a session, and every role may read it — pills need the vocabulary', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/roles' })).statusCode).toBe(401);

    const viewer = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/roles',
      cookie: await memberCookie(ctx.db, 'viewer'),
    });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json().roles.map((role: { id: string }) => role.id)).toEqual([
      'admin',
      'manager',
      'viewer',
    ]);
    expect(viewer.json().roles[0].permissions).toHaveLength(ACTIONS.length);
  });
});

describe('the roles endpoints are behind roles.manage', () => {
  it('turns a manager away from every one of them', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await memberCookie(ctx.db, 'manager');

    const attempts = [
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/roles',
        cookie: manager,
        body: { label: 'Auditor', color: 'warn' },
      }),
      await inject(ctx.app, {
        method: 'PATCH',
        url: '/api/v1/roles/viewer',
        cookie: manager,
        body: { label: 'Read only' },
      }),
      await inject(ctx.app, {
        method: 'DELETE',
        url: '/api/v1/roles/viewer',
        cookie: manager,
      }),
      await inject(ctx.app, {
        method: 'PUT',
        url: '/api/v1/roles/permissions',
        cookie: manager,
        body: { grants: [] },
      }),
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/roles/order',
        cookie: manager,
        body: { order: ['viewer', 'manager', 'admin'] },
      }),
    ];

    for (const res of attempts) expect(res.statusCode).toBe(403);
    expect(await listRoles(ctx.db)).toHaveLength(3);
  });
});

describe('an admin editing the roles over HTTP', () => {
  it('adds, renames, reorders, grants and removes a role', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/roles',
      cookie,
      body: { label: 'Auditor', description: 'Reads the books', color: 'warn' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().role).toMatchObject({
      id: 'auditor',
      label: 'Auditor',
      description: 'Reads the books',
      color: 'warn',
      isSystem: false,
      memberCount: 0,
      permissions: [],
    });

    const renamed = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/roles/auditor',
      cookie,
      body: { label: 'Inspector', color: 'info' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().role).toMatchObject({ id: 'auditor', label: 'Inspector' });

    const reordered = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/roles/order',
      cookie,
      body: { order: ['auditor', 'admin', 'manager', 'viewer'] },
    });
    expect(reordered.statusCode).toBe(204);
    expect((await listRoles(ctx.db))[0]!.id).toBe('auditor');

    const granted = await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/roles/permissions',
      cookie,
      body: {
        grants: [
          { role: 'auditor', action: 'audit.view' },
          { role: 'auditor', action: 'export.run' },
        ],
      },
    });
    expect(granted.statusCode).toBe(200);
    // Manager's nine go, because the matrix sends every grant there is.
    expect(granted.json()).toEqual({ added: 2, removed: 9 });

    const removed = await inject(ctx.app, {
      method: 'DELETE',
      url: '/api/v1/roles/auditor',
      cookie,
    });
    expect(removed.statusCode).toBe(204);
    expect((await listRoles(ctx.db)).map((role) => role.id)).not.toContain('auditor');
  });

  it('404s an unknown role and 422s a payload the contract refuses', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    const missing = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/roles/nowhere',
      cookie,
      body: { label: 'Nowhere' },
    });
    expect(missing.statusCode).toBe(404);

    const badColor = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/roles',
      cookie,
      body: { label: 'Auditor', color: 'purple' },
    });
    expect(badColor.statusCode).toBe(422);

    const badAction = await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/roles/permissions',
      cookie,
      body: { grants: [{ role: 'viewer', action: 'assets.teleport' }] },
    });
    expect(badAction.statusCode).toBe(422);
  });

  it('answers 409 with the code for the system role and for a role in use', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await memberCookie(ctx.db, 'viewer');

    const system = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/roles/admin',
      cookie,
      body: { label: 'Owner' },
    });
    expect(system.statusCode).toBe(409);
    expect(system.json().error.code).toBe('system_role');

    const inUse = await inject(ctx.app, { method: 'DELETE', url: '/api/v1/roles/viewer', cookie });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error.code).toBe('role_in_use');
    expect(inUse.json().error.message).toMatch(/1 member/);

    const migrated = await inject(ctx.app, {
      method: 'DELETE',
      url: '/api/v1/roles/viewer?migrateTo=manager',
      cookie,
    });
    expect(migrated.statusCode).toBe(204);
    expect((await ctx.db.select().from(members).all()).at(-1)!.role).toBe('manager');
  });
});

/**
 * The whole point of the feature, exercised end to end: a role somebody made up
 * this morning decides what its holders may do, on every request, with no
 * build knowing the role exists.
 */
describe('what a member may do is resolved per request', () => {
  /** An admin, a custom role granted exactly `grants`, and a member holding it. */
  async function workspaceWith(grants: string[]) {
    const cookie = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/roles',
      cookie,
      body: { label: 'Floor staff', color: 'info' },
    });
    await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/roles/permissions',
      cookie,
      body: { grants: grants.map((action) => ({ role: 'floor_staff', action })) },
    });
    return { cookie, staff: await memberCookie(ctx.db, 'floor_staff') };
  }

  it('lets a custom role do exactly what it is granted, and nothing else', async () => {
    ctx = await buildTestApp();
    const { staff } = await workspaceWith(['assets.create']);

    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: staff,
      body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
    });
    expect(created.statusCode).toBe(200);

    // Granted one action, not a rank: everything else is still closed.
    const deleted = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${created.json().asset.id}`,
      cookie: staff,
    });
    expect(deleted.statusCode).toBe(403);
    expect((await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie: staff })).statusCode).toBe(403); // prettier-ignore
    // Reads stay open to every authenticated member, as they always have.
    expect((await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie: staff })).statusCode).toBe(200); // prettier-ignore
  });

  it('lands a revocation on the holder’s very next request, same session', async () => {
    ctx = await buildTestApp();
    const { cookie, staff } = await workspaceWith(['assets.create']);
    const body = { name: 'Dell U2723QE', category: 'monitors', status: 'available' };

    expect((await inject(ctx.app, { method: 'POST', url: '/api/v1/assets', cookie: staff, body })).statusCode).toBe(200); // prettier-ignore

    const revoked = await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/roles/permissions',
      cookie,
      body: { grants: [] },
    });
    expect(revoked.statusCode).toBe(200);

    // No session invalidation machinery: permissions resolve per request, so
    // the next one through the same cookie already knows.
    const after = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: staff,
      body: { ...body, name: 'Dell U2723QE (2)' },
    });
    expect(after.statusCode).toBe(403);
  });

  it('closes the door on a member whose role row is gone', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const orphan = await memberCookie(ctx.db, 'nowhere');

    // Unreachable in practice — deleting a role moves every member holding it
    // — but "the role is gone" must never read as "anything goes".
    expect((await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie: orphan })).statusCode).toBe(200); // prettier-ignore
    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: orphan,
      body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
    });
    expect(created.statusCode).toBe(403);
  });

  it('refuses to let somebody change what their own role may do, over HTTP', async () => {
    ctx = await buildTestApp();
    const { staff } = await workspaceWith(['roles.manage']);

    const grab = await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/roles/permissions',
      cookie: staff,
      body: {
        grants: [
          { role: 'floor_staff', action: 'roles.manage' },
          { role: 'floor_staff', action: 'workspace.delete' },
        ],
      },
    });
    expect(grab.statusCode).toBe(409);
    expect(grab.json().error.code).toBe('own_role');

    const rename = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/roles/floor_staff',
      cookie: staff,
      body: { label: 'Owners' },
    });
    expect(rename.statusCode).toBe(409);
    expect(rename.json().error.code).toBe('own_role');
  });
});
