import { DEFAULT_ROLES } from '@inventory/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { rolePermissions, roles } from '@/db/schema.js';
import { seed } from '@/db/seed.js';
import { emptyWorkspace } from '@/services/workspace.js';
import { buildTestApp, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const roleRows = async () => await ctx.db.select().from(roles).orderBy(roles.sortOrder);
const grantRows = async () => await ctx.db.select().from(rolePermissions);

/**
 * An upgraded instance must behave exactly as it did before roles were
 * editable: the ids `members.role` already holds, and Manager granted precisely
 * what the role ranking used to allow.
 */
describe('the boot seed lays down today’s roles', () => {
  it('writes the three default roles in the default order', async () => {
    ctx = await buildTestApp();
    const rows = await roleRows();

    expect(rows.map((row) => row.id)).toEqual(['admin', 'manager', 'viewer']);
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
    for (const [index, row] of rows.entries()) {
      const expected = DEFAULT_ROLES[index]!;
      expect(row, expected.id).toMatchObject({
        label: expected.label,
        description: expected.description,
        color: expected.color,
        isSystem: expected.isSystem,
      });
    }
  });

  it('stores Manager’s grants and not one row for Admin', async () => {
    ctx = await buildTestApp();

    const manager = DEFAULT_ROLES.find((role) => role.id === 'manager')!;
    expect((await grantRows()).filter((row) => row.roleId === 'manager').map((row) => row.action).sort()).toEqual([...manager.grants].sort()); // prettier-ignore
    // The system role's set is every action there is, resolved rather than
    // stored — a stored set is one a future action would be missing from.
    expect((await grantRows()).filter((row) => row.roleId === 'admin')).toEqual([]);
    expect((await grantRows()).filter((row) => row.roleId === 'viewer')).toEqual([]);
  });

  it('changes nothing when it runs again — it runs at every boot', async () => {
    ctx = await buildTestApp();
    const before = { roles: await roleRows(), grants: await grantRows() };

    await seed(ctx.db);
    await seed(ctx.db);

    expect(await roleRows()).toEqual(before.roles);
    expect(await grantRows()).toEqual(before.grants);
  });

  it('leaves an edited set alone rather than putting a deleted role back', async () => {
    ctx = await buildTestApp();
    await ctx.db.delete(rolePermissions);
    await ctx.db.delete(roles);
    await ctx.db.insert(roles).values({
      id: 'auditor',
      label: 'Auditor',
      description: 'Reads the books',
      color: 'warn',
      isSystem: false,
      sortOrder: 0,
      createdAt: '2026-08-18T09:00:00.000Z',
      updatedAt: '2026-08-18T09:00:00.000Z',
    });

    await seed(ctx.db);

    expect((await roleRows()).map((row) => row.id)).toEqual(['auditor']);
    expect(await grantRows()).toEqual([]);
  });

  /**
   * The danger zone promises "exactly where a fresh container starts", and a
   * set of roles somebody edited is not that — it is also what `seed:demo
   * --reset` runs, so roles left standing would make the second reset a
   * different workspace from the first.
   */
  it('comes back to the default after the workspace is emptied', async () => {
    ctx = await buildTestApp();
    await ctx.db.delete(rolePermissions);
    await ctx.db.delete(roles);

    await emptyWorkspace(ctx.deps);

    expect((await roleRows()).map((row) => row.id)).toEqual(['admin', 'manager', 'viewer']);
    expect(await grantRows()).toHaveLength(9);
  });
});
