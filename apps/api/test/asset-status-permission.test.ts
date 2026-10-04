import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, rolePermissions } from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

// `assets.change_status` is a box on the Roles page and a button in the web, so
// the door has to read it too: a PATCH that moves status needs it, a PATCH that
// edits anything else needs `assets.edit`, and one that does both needs both.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

async function withAsset(): Promise<string> {
  ctx = await buildTestApp();
  const admin = await setupOrg(ctx.app);
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie: admin,
    body: { name: 'ThinkPad X1', category: 'laptops', status: 'available' },
  });
  return res.json().asset.id as string;
}

/** The manager holds both grants by default; take one away. */
async function managerWithout(action: string): Promise<string> {
  await ctx.db
    .delete(rolePermissions)
    .where(and(eq(rolePermissions.roleId, 'manager'), eq(rolePermissions.action, action)));
  return memberCookie(ctx.db, 'manager');
}

/** A viewer granted only the one action. */
async function viewerWith(action: string): Promise<string> {
  await ctx.db.insert(rolePermissions).values({ roleId: 'viewer', action });
  return memberCookie(ctx.db, 'viewer');
}

const patch = (id: string, cookie: string, body: Record<string, unknown>) =>
  inject(ctx.app, { method: 'PATCH', url: `/api/v1/assets/${id}`, cookie, body });

const statusOf = async (id: string) =>
  (await ctx.db.select().from(assets).where(eq(assets.id, id)))[0]!.status;

describe('PATCH /assets/:id and assets.change_status', () => {
  it('refuses a status move to a role with edit but not change_status', async () => {
    const id = await withAsset();
    const editor = await managerWithout('assets.change_status');

    const res = await patch(id, editor, { status: 'in_repair' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    expect(await statusOf(id)).toBe('available');
  });

  it('refuses a mixed edit whose status moves, and writes none of it', async () => {
    const id = await withAsset();
    const editor = await managerWithout('assets.change_status');

    const res = await patch(id, editor, { name: 'Renamed', status: 'in_repair' });
    expect(res.statusCode).toBe(403);
    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, id));
    expect(row!.name).toBe('ThinkPad X1');
  });

  it('lets that role save the edit form, which resends the status unchanged', async () => {
    const id = await withAsset();
    const editor = await managerWithout('assets.change_status');

    const res = await patch(id, editor, { name: 'Renamed', status: 'available' });
    expect(res.statusCode).toBe(200);
    expect(res.json().asset.name).toBe('Renamed');
  });

  it('lets a role with change_status but not edit move the status', async () => {
    const id = await withAsset();
    const mover = await viewerWith('assets.change_status');

    const res = await patch(id, mover, { status: 'in_repair' });
    expect(res.statusCode).toBe(200);
    expect(await statusOf(id)).toBe('in_repair');
  });

  it('refuses that role any other key', async () => {
    const id = await withAsset();
    const mover = await viewerWith('assets.change_status');

    const res = await patch(id, mover, { name: 'Renamed' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
  });

  it('lets a role with both do both at once', async () => {
    const id = await withAsset();
    const manager = await memberCookie(ctx.db, 'manager');

    const res = await patch(id, manager, { name: 'Renamed', status: 'in_repair' });
    expect(res.statusCode).toBe(200);
    expect(res.json().asset).toMatchObject({ name: 'Renamed', status: 'in_repair' });
  });

  it('still answers an anonymous caller 401 before anything else', async () => {
    const id = await withAsset();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      body: { status: 42 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('answers a role with neither 403 rather than a 422 on a junk body', async () => {
    const id = await withAsset();
    const viewer = await memberCookie(ctx.db, 'viewer');
    // A role holding neither grant learns nothing about the body's shape.
    const res = await patch(id, viewer, { status: 42 });
    expect(res.statusCode).toBe(403);
  });
});
