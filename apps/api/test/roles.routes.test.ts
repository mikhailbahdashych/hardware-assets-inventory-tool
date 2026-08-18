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
      cookie: memberCookie(ctx.db, 'viewer'),
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
    const manager = memberCookie(ctx.db, 'manager');

    const attempts = [
      inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/roles',
        cookie: manager,
        body: { label: 'Auditor', color: 'warn' },
      }),
      inject(ctx.app, {
        method: 'PATCH',
        url: '/api/v1/roles/viewer',
        cookie: manager,
        body: { label: 'Read only' },
      }),
      inject(ctx.app, { method: 'DELETE', url: '/api/v1/roles/viewer', cookie: manager }),
      inject(ctx.app, {
        method: 'PUT',
        url: '/api/v1/roles/permissions',
        cookie: manager,
        body: { grants: [] },
      }),
      inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/roles/order',
        cookie: manager,
        body: { order: ['viewer', 'manager', 'admin'] },
      }),
    ];

    for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(403);
    expect(listRoles(ctx.db)).toHaveLength(3);
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
    expect(listRoles(ctx.db)[0]!.id).toBe('auditor');

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
    expect(listRoles(ctx.db).map((role) => role.id)).not.toContain('auditor');
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
    memberCookie(ctx.db, 'viewer');

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
    expect(ctx.db.select().from(members).all().at(-1)!.role).toBe('manager');
  });
});
