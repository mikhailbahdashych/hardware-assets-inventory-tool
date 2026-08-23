import { eq } from 'drizzle-orm';
import { MAX_ASSET_STATUSES } from '@inventory/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, assetStatuses, assetStatusTransitions, auditEvents } from '@/db/schema.js';
import type { Actor } from '@/types/audit.js';
import {
  assignableStatuses,
  createStatus,
  deleteStatus,
  getWorkflow,
  reorderStatuses,
  replaceTransitions,
  requireStatus,
  transitionAllowed,
  updateStatus,
} from '@/services/workflow.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/**
 * A real member, because every mutation writes an audit row and
 * `audit_events.actor_member_id` is a foreign key. The service tests call the
 * functions directly — the same reasoning as `last-admin.test.ts`: several of
 * these guards are unreachable over HTTP today and are the backstop for the
 * day something makes them reachable.
 */
async function admin(): Promise<{ cookie: string; actor: Actor }> {
  const cookie = await setupOrg(ctx.app);
  const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
  const member = me.json().member as { id: string; displayName: string };
  return { cookie, actor: { id: member.id, displayName: member.displayName } };
}

/**
 * A 422 carries its detail in `fields`, not in the message — the envelope's
 * message is always "Please correct the highlighted fields." — so these
 * assertions read the field the form would highlight.
 */
async function fieldErrors(run: () => unknown): Promise<Record<string, string>> {
  try {
    await run();
  } catch (error) {
    const fields = (error as { fields?: Record<string, string> }).fields;
    if (!fields) {
      throw new Error(`expected field errors, got: ${(error as Error).message}`, { cause: error });
    }
    return fields;
  }
  throw new Error('expected a throw, got a return');
}

const events = async (action: string) =>
  (await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, action))).map((row) => ({
    ...row,
    params: JSON.parse(row.params) as Record<string, unknown>,
  }));

async function addAsset(status: string, tag = 'AST-0001'): Promise<string> {
  const at = '2026-08-17T09:00:00.000Z';
  await ctx.db.insert(assets).values({
    id: `asset-${tag}`,
    assetTag: tag,
    name: 'MacBook Pro 14"',
    category: 'laptops',
    status,
    createdAt: at,
    updatedAt: at,
  });
  return `asset-${tag}`;
}

describe('GET /api/v1/workflow', () => {
  it('needs a session, and every role may read it — pills need the vocabulary', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/workflow' })).statusCode).toBe(401);

    const viewer = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/workflow',
      cookie: await memberCookie(ctx.db, 'viewer'),
    });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json().statuses).toHaveLength(6);
    expect(viewer.json().transitions).toHaveLength(20);
  });
});

describe('the workflow endpoints are admin-only', () => {
  it('turns a manager away from every one of them', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await memberCookie(ctx.db, 'manager');

    const attempts = [
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/workflow/statuses',
        cookie: manager,
        body: { label: 'On loan', color: 'info' },
      }),
      await inject(ctx.app, {
        method: 'PATCH',
        url: '/api/v1/workflow/statuses/ordered',
        cookie: manager,
        body: { label: 'Ordered in' },
      }),
      await inject(ctx.app, {
        method: 'DELETE',
        url: '/api/v1/workflow/statuses/ordered',
        cookie: manager,
      }),
      await inject(ctx.app, {
        method: 'PUT',
        url: '/api/v1/workflow/transitions',
        cookie: manager,
        body: { transitions: [] },
      }),
      await inject(ctx.app, {
        method: 'PUT',
        url: '/api/v1/workflow/statuses/order',
        cookie: manager,
        body: { ids: ['available'] },
      }),
    ];

    for (const res of attempts) expect(res.statusCode).toBe(403);
    expect((await getWorkflow(ctx.db)).statuses).toHaveLength(6);
  });
});

describe('an admin editing the workflow over HTTP', () => {
  it('adds, renames, reorders and removes a status', async () => {
    ctx = await buildTestApp();
    const { cookie } = await admin();

    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/workflow/statuses',
      cookie,
      body: { label: 'On loan', color: 'info', checkinTarget: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toMatchObject({
      id: 'on_loan',
      label: 'On loan',
      color: 'info',
      assignableFrom: false,
      checkinTarget: true,
    });

    const renamed = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/workflow/statuses/on_loan',
      cookie,
      body: { label: 'Out on loan', color: 'warn' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().status).toMatchObject({ id: 'on_loan', label: 'Out on loan' });

    const reordered = await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/workflow/statuses/order',
      cookie,
      body: {
        ids: ['on_loan', ...(await getWorkflow(ctx.db)).statuses.map((s) => s.id).slice(0, 6)],
      },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().statuses[0].id).toBe('on_loan');

    const saved = await inject(ctx.app, {
      method: 'PUT',
      url: '/api/v1/workflow/transitions',
      cookie,
      body: { transitions: [{ from: 'available', to: 'on_loan' }] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().transitions).toEqual([{ from: 'available', to: 'on_loan' }]);

    const removed = await inject(ctx.app, {
      method: 'DELETE',
      url: '/api/v1/workflow/statuses/on_loan',
      cookie,
    });
    expect(removed.statusCode).toBe(204);
    // The edge went with it rather than pointing at nothing.
    expect((await getWorkflow(ctx.db)).transitions).toEqual([]);
  });

  it('404s an unknown status and 422s a payload the contract refuses', async () => {
    ctx = await buildTestApp();
    const { cookie } = await admin();

    const missing = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/workflow/statuses/nowhere',
      cookie,
      body: { label: 'Nowhere' },
    });
    expect(missing.statusCode).toBe(404);

    const badColor = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/workflow/statuses',
      cookie,
      body: { label: 'On loan', color: 'purple' },
    });
    expect(badColor.statusCode).toBe(422);
  });

  it('refuses to delete a status assets carry until it is told where they go', async () => {
    ctx = await buildTestApp();
    const { cookie } = await admin();
    await addAsset('lost_stolen', 'AST-0001');

    const blocked = await inject(ctx.app, {
      method: 'DELETE',
      url: '/api/v1/workflow/statuses/lost_stolen',
      cookie,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('status_in_use');
    expect(blocked.json().error.message).toMatch(/1 asset/);

    const migrated = await inject(ctx.app, {
      method: 'DELETE',
      url: '/api/v1/workflow/statuses/lost_stolen?migrateTo=retired',
      cookie,
    });
    expect(migrated.statusCode).toBe(204);
    expect((await ctx.db.select().from(assets))[0]!.status).toBe('retired');
    expect((await getWorkflow(ctx.db)).statuses.map((status) => status.id)).not.toContain(
      'lost_stolen',
    );
  });
});

describe('reading the workflow', () => {
  it('answers the seeded statuses in sort order with their flags', async () => {
    ctx = await buildTestApp();
    const payload = await getWorkflow(ctx.db);

    expect(payload.statuses.map((status) => status.id)).toEqual([
      'available',
      'assigned',
      'in_repair',
      'ordered',
      'retired',
      'lost_stolen',
    ]);
    expect(payload.statuses[0]).toEqual({
      id: 'available',
      label: 'Available',
      color: 'ok',
      isSystem: false,
      assignableFrom: true,
      checkinTarget: true,
      sortOrder: 0,
    });
    expect(payload.transitions).toHaveLength(20);
  });
});

describe('creating a status', () => {
  it('slugs the label, lands it last, and audits it', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const created = await createStatus(ctx.deps, actor, {
      label: 'On loan',
      color: 'info',
      assignableFrom: false,
      checkinTarget: true,
    });

    expect(created).toMatchObject({
      id: 'on_loan',
      label: 'On loan',
      color: 'info',
      isSystem: false,
      checkinTarget: true,
      sortOrder: 6,
    });
    expect((await getWorkflow(ctx.db)).statuses.at(-1)!.id).toBe('on_loan');
    expect(await events('workflow.status_created')).toMatchObject([
      { type: 'system', actorMemberId: actor.id, params: { label: 'On loan' } },
    ]);
  });

  it('refuses a label that leaves no slug, and one that is already taken', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const input = { assignableFrom: false, checkinTarget: false } as const;

    expect(
      (await fieldErrors(() => createStatus(ctx.deps, actor, { label: '—', color: 'ok', ...input }))).label, // prettier-ignore
    ).toMatch(/letters or numbers/i);
    // Case-insensitively taken, and taken as a slug: "In Repair" is in_repair.
    expect(
      (
        await fieldErrors(() =>
          createStatus(ctx.deps, actor, { label: 'available', color: 'ok', ...input }),
        )
      ).label,
    ).toMatch(/already exists/i);
    expect(
      (
        await fieldErrors(() =>
          createStatus(ctx.deps, actor, { label: 'In Repair', color: 'ok', ...input }),
        )
      ).label,
    ).toMatch(/already exists/i);

    expect((await getWorkflow(ctx.db)).statuses).toHaveLength(6);
    expect(await events('workflow.status_created')).toEqual([]);
  });

  it('stops at the cap, because the matrix has to stay readable', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    for (let index = 6; index < MAX_ASSET_STATUSES; index += 1) {
      await createStatus(ctx.deps, actor, {
        label: `Status ${index}`,
        color: 'neut',
        assignableFrom: false,
        checkinTarget: false,
      });
    }
    expect((await getWorkflow(ctx.db)).statuses).toHaveLength(MAX_ASSET_STATUSES);

    await expect(
      createStatus(ctx.deps, actor, {
        label: 'One too many',
        color: 'neut',
        assignableFrom: false,
        checkinTarget: false,
      }),
    ).rejects.toThrow(/20 statuses/);
  });
});

describe('editing a status', () => {
  it('renames and recolors without touching the slug assets carry', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    await addAsset('in_repair');

    const updated = await updateStatus(ctx.deps, actor, 'in_repair', {
      label: 'At the repair shop',
      color: 'err',
    });

    expect(updated).toMatchObject({
      id: 'in_repair',
      label: 'At the repair shop',
      color: 'err',
    });
    expect((await ctx.db.select().from(assets))[0]!.status).toBe('in_repair');
    expect(await events('workflow.status_updated')).toMatchObject([
      { params: { label: 'At the repair shop', changedFields: ['label', 'color'] } },
    ]);
  });

  it('writes nothing at all when the patch changes nothing', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    await updateStatus(ctx.deps, actor, 'ordered', { label: 'Ordered', color: 'info' });

    expect(await events('workflow.status_updated')).toEqual([]);
  });

  it('lets the system status be renamed but never re-flagged', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect((await updateStatus(ctx.deps, actor, 'assigned', { label: 'In use' })).label).toBe(
      'In use',
    );
    expect(
      (await fieldErrors(() => updateStatus(ctx.deps, actor, 'assigned', { assignableFrom: true })))
        .assignableFrom,
    ).toMatch(/system status/i);
    expect(
      (await fieldErrors(() => updateStatus(ctx.deps, actor, 'assigned', { checkinTarget: true })))
        .checkinTarget,
    ).toMatch(/system status/i);
  });

  it('refuses a rename onto another status’s name', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(
      (await fieldErrors(() => updateStatus(ctx.deps, actor, 'ordered', { label: 'retired' })))
        .label,
    ).toMatch(/already exists/i);
    // Its own name, in its own case, is not a collision.
    expect((await updateStatus(ctx.deps, actor, 'ordered', { label: 'Ordered' })).label).toBe(
      'Ordered',
    );
  });

  it('will not turn off the last way to hand an asset out or take one back', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    await updateStatus(ctx.deps, actor, 'ordered', { assignableFrom: false });
    await expect(
      updateStatus(ctx.deps, actor, 'available', { assignableFrom: false }),
    ).rejects.toThrow(/handed out/i);

    await updateStatus(ctx.deps, actor, 'in_repair', { checkinTarget: false });
    await updateStatus(ctx.deps, actor, 'retired', { checkinTarget: false });
    await expect(
      updateStatus(ctx.deps, actor, 'available', { checkinTarget: false }),
    ).rejects.toThrow(/checked in/i);

    const workflow = await getWorkflow(ctx.db);
    expect(workflow.statuses.filter((status) => status.assignableFrom)).toHaveLength(1);
    expect(workflow.statuses.filter((status) => status.checkinTarget)).toHaveLength(1);
  });
});

describe('deleting a status', () => {
  it('takes an unused status and its edges with it', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    await deleteStatus(ctx.deps, actor, 'lost_stolen');

    const workflow = await getWorkflow(ctx.db);
    expect(workflow.statuses.map((status) => status.id)).not.toContain('lost_stolen');
    // Four statuses left in the mesh: 4 × 3 = 12 edges, none dangling.
    expect(workflow.transitions).toHaveLength(12);
    expect(await events('workflow.status_deleted')).toMatchObject([
      { params: { label: 'Lost/Stolen', assetCount: 0 } },
    ]);
  });

  it('refuses the system status', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    await expect(deleteStatus(ctx.deps, actor, 'assigned')).rejects.toThrow(/system status/i);
    expect((await getWorkflow(ctx.db)).statuses).toHaveLength(6);
  });

  it('refuses to take the last assignable status or the last check-in target', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    await deleteStatus(ctx.deps, actor, 'ordered');
    await expect(deleteStatus(ctx.deps, actor, 'available')).rejects.toThrow(/handed out/i);

    await updateStatus(ctx.deps, actor, 'available', { checkinTarget: false });
    await deleteStatus(ctx.deps, actor, 'retired');
    await expect(deleteStatus(ctx.deps, actor, 'in_repair')).rejects.toThrow(/checked in/i);
  });

  it('says how many assets are in the way, and moves them when told where', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    await addAsset('lost_stolen', 'AST-0001');
    await addAsset('lost_stolen', 'AST-0002');

    await expect(deleteStatus(ctx.deps, actor, 'lost_stolen')).rejects.toThrow(/2 assets/);
    expect((await getWorkflow(ctx.db)).statuses.map((status) => status.id)).toContain(
      'lost_stolen',
    );

    await deleteStatus(ctx.deps, actor, 'lost_stolen', 'retired');

    expect((await ctx.db.select().from(assets)).map((row) => row.status)).toEqual([
      // prettier-ignore
      'retired',
      'retired',
    ]);
    expect((await getWorkflow(ctx.db)).statuses.map((status) => status.id)).not.toContain(
      'lost_stolen',
    );
    // One summary event, not one per asset.
    expect(await events('workflow.status_deleted')).toMatchObject([
      { params: { label: 'Lost/Stolen', migratedToLabel: 'Retired', assetCount: 2 } },
    ]);
  });

  it('refuses a destination that is missing, the system status, or itself', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    await addAsset('lost_stolen');

    const attempt = async (migrateTo: string) =>
      (await fieldErrors(() => deleteStatus(ctx.deps, actor, 'lost_stolen', migrateTo))).migrateTo;
    expect(await attempt('nowhere')).toMatch(/could not be found/i);
    expect(await attempt('assigned')).toMatch(/assigning/i);
    expect(await attempt('lost_stolen')).toMatch(/different status/i);

    expect((await ctx.db.select().from(assets))[0]!.status).toBe('lost_stolen');
    expect((await getWorkflow(ctx.db)).statuses).toHaveLength(6);
  });
});

describe('replacing the transition graph', () => {
  it('stores exactly what it is given, deduped, and audits the difference', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const stored = await replaceTransitions(ctx.deps, actor, {
      transitions: [
        { from: 'ordered', to: 'available' },
        { from: 'available', to: 'retired' },
        { from: 'ordered', to: 'available' },
      ],
    });

    expect(stored).toEqual([
      { from: 'available', to: 'retired' },
      { from: 'ordered', to: 'available' },
    ]);
    // 20 seeded, 2 kept: 18 gone, none added.
    expect(await events('workflow.transitions_updated')).toMatchObject([
      { params: { added: 0, removed: 18 } },
    ]);
  });

  it('empties the graph when that is what the matrix says', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(await replaceTransitions(ctx.deps, actor, { transitions: [] })).toEqual([]);
    expect(await ctx.db.select().from(assetStatusTransitions)).toEqual([]);
  });

  it('writes nothing when the graph is resubmitted unchanged', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    await replaceTransitions(ctx.deps, actor, {
      transitions: (await getWorkflow(ctx.db)).transitions,
    });

    expect(await events('workflow.transitions_updated')).toEqual([]);
  });

  it('refuses an unknown endpoint, a self-edge, and anything touching assigned', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const attempt = async (from: string, to: string) =>
      (
        await fieldErrors(() =>
          replaceTransitions(ctx.deps, actor, { transitions: [{ from, to }] }),
        )
      ).transitions;

    expect(await attempt('available', 'nowhere')).toMatch(/nowhere/);
    expect(await attempt('nowhere', 'available')).toMatch(/nowhere/);
    expect(await attempt('available', 'available')).toMatch(/itself/i);
    expect(await attempt('available', 'assigned')).toMatch(/assigning/i);
    expect(await attempt('assigned', 'available')).toMatch(/assigning/i);

    // Nothing half-applied: the seeded mesh is still whole.
    expect((await getWorkflow(ctx.db)).transitions).toHaveLength(20);
  });
});

describe('reordering statuses', () => {
  it('takes a permutation and renumbers every row', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const reordered = await reorderStatuses(ctx.deps, actor, [
      'ordered',
      'available',
      'assigned',
      'in_repair',
      'lost_stolen',
      'retired',
    ]);

    expect(reordered.map((status) => status.id)).toEqual([
      'ordered',
      'available',
      'assigned',
      'in_repair',
      'lost_stolen',
      'retired',
    ]);
    expect(reordered.map((status) => status.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect((await getWorkflow(ctx.db)).statuses[0]!.id).toBe('ordered');
    expect(await events('workflow.statuses_reordered')).toHaveLength(1);
  });

  it('refuses a list that is not every status exactly once', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const ids = (await getWorkflow(ctx.db)).statuses.map((status) => status.id);

    const attempt = async (sent: string[]) =>
      (await fieldErrors(() => reorderStatuses(ctx.deps, actor, sent))).ids;

    // Too short, the right length with one id twice, and one id that is not
    // a status at all — a partial renumbering would leave two rows sharing a
    // place, so none of the three may get halfway.
    expect(await attempt(ids.slice(1))).toMatch(/exactly once/i);
    expect(await attempt([...ids.slice(2), ids[1]!, ids[1]!])).toMatch(/exactly once/i);
    expect(await attempt([...ids.slice(1), 'nowhere'])).toMatch(/exactly once/i);

    expect((await getWorkflow(ctx.db)).statuses.map((status) => status.id)).toEqual(ids);
  });
});

describe('what the other services ask the workflow', () => {
  it('hands back a status row or a field error naming the field that carried it', async () => {
    ctx = await buildTestApp();

    expect((await requireStatus(ctx.db, 'in_repair')).label).toBe('In repair');
    // Which field carried the bad slug decides which input the form highlights.
    expect((await fieldErrors(() => requireStatus(ctx.db, 'nowhere'))).status).toMatch(/nowhere/);
    expect(
      (await fieldErrors(() => requireStatus(ctx.db, 'nowhere', 'newStatus'))).newStatus,
    ).toMatch(/nowhere/);
  });

  it('answers whether an edge exists, from the table and nowhere else', async () => {
    ctx = await buildTestApp();

    expect(await transitionAllowed(ctx.db, 'available', 'retired')).toBe(true);
    expect(await transitionAllowed(ctx.db, 'available', 'assigned')).toBe(false);

    await ctx.db
      .delete(assetStatusTransitions)
      .where(eq(assetStatusTransitions.fromStatus, 'available'));
    expect(await transitionAllowed(ctx.db, 'available', 'retired')).toBe(false);
  });

  it('lists the statuses an asset can be handed out from, in sort order', async () => {
    ctx = await buildTestApp();

    expect((await assignableStatuses(ctx.db)).map((row) => row.label)).toEqual([
      'Available',
      'Ordered',
    ]);

    await ctx.db
      .update(assetStatuses)
      .set({ assignableFrom: true })
      .where(eq(assetStatuses.id, 'in_repair'));
    expect((await assignableStatuses(ctx.db)).map((row) => row.label)).toEqual([
      'Available',
      'In repair',
      'Ordered',
    ]);
  });
});
