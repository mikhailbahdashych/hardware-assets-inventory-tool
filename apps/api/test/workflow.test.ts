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
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

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

const events = (action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, action))
    .all()
    .map((row) => ({ ...row, params: JSON.parse(row.params) as Record<string, unknown> }));

function addAsset(status: string, tag = 'AST-0001'): string {
  const at = '2026-08-17T09:00:00.000Z';
  ctx.db
    .insert(assets)
    .values({
      id: `asset-${tag}`,
      assetTag: tag,
      name: 'MacBook Pro 14"',
      category: 'laptops',
      status,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return `asset-${tag}`;
}

describe('reading the workflow', () => {
  it('answers the seeded statuses in sort order with their flags', async () => {
    ctx = await buildTestApp();
    const payload = getWorkflow(ctx.db);

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

    const created = createStatus(ctx.deps, actor, {
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
    expect(getWorkflow(ctx.db).statuses.at(-1)!.id).toBe('on_loan');
    expect(events('workflow.status_created')).toMatchObject([
      { type: 'system', actorMemberId: actor.id, params: { label: 'On loan' } },
    ]);
  });

  it('refuses a label that leaves no slug, and one that is already taken', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const input = { assignableFrom: false, checkinTarget: false } as const;

    expect(
      fieldErrors(() => createStatus(ctx.deps, actor, { label: '—', color: 'ok', ...input })).label,
    ).toMatch(/letters or numbers/i);
    // Case-insensitively taken, and taken as a slug: "In Repair" is in_repair.
    expect(
      fieldErrors(() =>
        createStatus(ctx.deps, actor, { label: 'available', color: 'ok', ...input }),
      ).label,
    ).toMatch(/already exists/i);
    expect(
      fieldErrors(() =>
        createStatus(ctx.deps, actor, { label: 'In Repair', color: 'ok', ...input }),
      ).label,
    ).toMatch(/already exists/i);

    expect(getWorkflow(ctx.db).statuses).toHaveLength(6);
    expect(events('workflow.status_created')).toEqual([]);
  });

  it('stops at the cap, because the matrix has to stay readable', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    for (let index = 6; index < MAX_ASSET_STATUSES; index += 1) {
      createStatus(ctx.deps, actor, {
        label: `Status ${index}`,
        color: 'neut',
        assignableFrom: false,
        checkinTarget: false,
      });
    }
    expect(getWorkflow(ctx.db).statuses).toHaveLength(MAX_ASSET_STATUSES);

    expect(() =>
      createStatus(ctx.deps, actor, {
        label: 'One too many',
        color: 'neut',
        assignableFrom: false,
        checkinTarget: false,
      }),
    ).toThrow(/20 statuses/);
  });
});

describe('editing a status', () => {
  it('renames and recolors without touching the slug assets carry', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    addAsset('in_repair');

    const updated = updateStatus(ctx.deps, actor, 'in_repair', {
      label: 'At the repair shop',
      color: 'err',
    });

    expect(updated).toMatchObject({ id: 'in_repair', label: 'At the repair shop', color: 'err' });
    expect(ctx.db.select().from(assets).all()[0]!.status).toBe('in_repair');
    expect(events('workflow.status_updated')).toMatchObject([
      { params: { label: 'At the repair shop', changedFields: ['label', 'color'] } },
    ]);
  });

  it('writes nothing at all when the patch changes nothing', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    updateStatus(ctx.deps, actor, 'ordered', { label: 'Ordered', color: 'info' });

    expect(events('workflow.status_updated')).toEqual([]);
  });

  it('lets the system status be renamed but never re-flagged', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(updateStatus(ctx.deps, actor, 'assigned', { label: 'In use' }).label).toBe('In use');
    expect(
      fieldErrors(() => updateStatus(ctx.deps, actor, 'assigned', { assignableFrom: true }))
        .assignableFrom,
    ).toMatch(/system status/i);
    expect(
      fieldErrors(() => updateStatus(ctx.deps, actor, 'assigned', { checkinTarget: true }))
        .checkinTarget,
    ).toMatch(/system status/i);
  });

  it('refuses a rename onto another status’s name', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(
      fieldErrors(() => updateStatus(ctx.deps, actor, 'ordered', { label: 'retired' })).label,
    ).toMatch(/already exists/i);
    // Its own name, in its own case, is not a collision.
    expect(updateStatus(ctx.deps, actor, 'ordered', { label: 'Ordered' }).label).toBe('Ordered');
  });

  it('will not turn off the last way to hand an asset out or take one back', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    updateStatus(ctx.deps, actor, 'ordered', { assignableFrom: false });
    expect(() => updateStatus(ctx.deps, actor, 'available', { assignableFrom: false })).toThrow(
      /handed out/i,
    );

    updateStatus(ctx.deps, actor, 'in_repair', { checkinTarget: false });
    updateStatus(ctx.deps, actor, 'retired', { checkinTarget: false });
    expect(() => updateStatus(ctx.deps, actor, 'available', { checkinTarget: false })).toThrow(
      /checked in/i,
    );

    const workflow = getWorkflow(ctx.db);
    expect(workflow.statuses.filter((status) => status.assignableFrom)).toHaveLength(1);
    expect(workflow.statuses.filter((status) => status.checkinTarget)).toHaveLength(1);
  });
});

describe('deleting a status', () => {
  it('takes an unused status and its edges with it', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    deleteStatus(ctx.deps, actor, 'lost_stolen');

    const workflow = getWorkflow(ctx.db);
    expect(workflow.statuses.map((status) => status.id)).not.toContain('lost_stolen');
    // Four statuses left in the mesh: 4 × 3 = 12 edges, none dangling.
    expect(workflow.transitions).toHaveLength(12);
    expect(events('workflow.status_deleted')).toMatchObject([
      { params: { label: 'Lost/Stolen', assetCount: 0 } },
    ]);
  });

  it('refuses the system status', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(() => deleteStatus(ctx.deps, actor, 'assigned')).toThrow(/system status/i);
    expect(getWorkflow(ctx.db).statuses).toHaveLength(6);
  });

  it('refuses to take the last assignable status or the last check-in target', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    deleteStatus(ctx.deps, actor, 'ordered');
    expect(() => deleteStatus(ctx.deps, actor, 'available')).toThrow(/handed out/i);

    updateStatus(ctx.deps, actor, 'available', { checkinTarget: false });
    deleteStatus(ctx.deps, actor, 'retired');
    expect(() => deleteStatus(ctx.deps, actor, 'in_repair')).toThrow(/checked in/i);
  });

  it('says how many assets are in the way, and moves them when told where', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    addAsset('lost_stolen', 'AST-0001');
    addAsset('lost_stolen', 'AST-0002');

    expect(() => deleteStatus(ctx.deps, actor, 'lost_stolen')).toThrow(/2 assets/);
    expect(getWorkflow(ctx.db).statuses.map((status) => status.id)).toContain('lost_stolen');

    deleteStatus(ctx.deps, actor, 'lost_stolen', 'retired');

    expect(
      ctx.db
        .select()
        .from(assets)
        .all()
        .map((row) => row.status),
    ).toEqual([
      // prettier-ignore
      'retired',
      'retired',
    ]);
    expect(getWorkflow(ctx.db).statuses.map((status) => status.id)).not.toContain('lost_stolen');
    // One summary event, not one per asset.
    expect(events('workflow.status_deleted')).toMatchObject([
      { params: { label: 'Lost/Stolen', migratedToLabel: 'Retired', assetCount: 2 } },
    ]);
  });

  it('refuses a destination that is missing, the system status, or itself', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    addAsset('lost_stolen');

    const attempt = (migrateTo: string) =>
      fieldErrors(() => deleteStatus(ctx.deps, actor, 'lost_stolen', migrateTo)).migrateTo;
    expect(attempt('nowhere')).toMatch(/could not be found/i);
    expect(attempt('assigned')).toMatch(/assigning/i);
    expect(attempt('lost_stolen')).toMatch(/different status/i);

    expect(ctx.db.select().from(assets).all()[0]!.status).toBe('lost_stolen');
    expect(getWorkflow(ctx.db).statuses).toHaveLength(6);
  });
});

describe('replacing the transition graph', () => {
  it('stores exactly what it is given, deduped, and audits the difference', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const stored = replaceTransitions(ctx.deps, actor, {
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
    expect(events('workflow.transitions_updated')).toMatchObject([
      { params: { added: 0, removed: 18 } },
    ]);
  });

  it('empties the graph when that is what the matrix says', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    expect(replaceTransitions(ctx.deps, actor, { transitions: [] })).toEqual([]);
    expect(ctx.db.select().from(assetStatusTransitions).all()).toEqual([]);
  });

  it('writes nothing when the graph is resubmitted unchanged', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    replaceTransitions(ctx.deps, actor, { transitions: getWorkflow(ctx.db).transitions });

    expect(events('workflow.transitions_updated')).toEqual([]);
  });

  it('refuses an unknown endpoint, a self-edge, and anything touching assigned', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const attempt = (from: string, to: string) =>
      fieldErrors(() => replaceTransitions(ctx.deps, actor, { transitions: [{ from, to }] }))
        .transitions;

    expect(attempt('available', 'nowhere')).toMatch(/nowhere/);
    expect(attempt('nowhere', 'available')).toMatch(/nowhere/);
    expect(attempt('available', 'available')).toMatch(/itself/i);
    expect(attempt('available', 'assigned')).toMatch(/assigning/i);
    expect(attempt('assigned', 'available')).toMatch(/assigning/i);

    // Nothing half-applied: the seeded mesh is still whole.
    expect(getWorkflow(ctx.db).transitions).toHaveLength(20);
  });
});

describe('reordering statuses', () => {
  it('takes a permutation and renumbers every row', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();

    const reordered = reorderStatuses(ctx.deps, actor, [
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
    expect(getWorkflow(ctx.db).statuses[0]!.id).toBe('ordered');
    expect(events('workflow.statuses_reordered')).toHaveLength(1);
  });

  it('refuses a list that is not every status exactly once', async () => {
    ctx = await buildTestApp();
    const { actor } = await admin();
    const ids = getWorkflow(ctx.db).statuses.map((status) => status.id);

    const attempt = (sent: string[]) =>
      fieldErrors(() => reorderStatuses(ctx.deps, actor, sent)).ids;

    // Too short, the right length with one id twice, and one id that is not
    // a status at all — a partial renumbering would leave two rows sharing a
    // place, so none of the three may get halfway.
    expect(attempt(ids.slice(1))).toMatch(/exactly once/i);
    expect(attempt([...ids.slice(2), ids[1]!, ids[1]!])).toMatch(/exactly once/i);
    expect(attempt([...ids.slice(1), 'nowhere'])).toMatch(/exactly once/i);

    expect(getWorkflow(ctx.db).statuses.map((status) => status.id)).toEqual(ids);
  });
});

describe('what the other services ask the workflow', () => {
  it('hands back a status row or a field error naming the field that carried it', async () => {
    ctx = await buildTestApp();

    expect(requireStatus(ctx.db, 'in_repair').label).toBe('In repair');
    // Which field carried the bad slug decides which input the form highlights.
    expect(fieldErrors(() => requireStatus(ctx.db, 'nowhere')).status).toMatch(/nowhere/);
    expect(fieldErrors(() => requireStatus(ctx.db, 'nowhere', 'newStatus')).newStatus).toMatch(
      /nowhere/,
    );
  });

  it('answers whether an edge exists, from the table and nowhere else', async () => {
    ctx = await buildTestApp();

    expect(transitionAllowed(ctx.db, 'available', 'retired')).toBe(true);
    expect(transitionAllowed(ctx.db, 'available', 'assigned')).toBe(false);

    ctx.db
      .delete(assetStatusTransitions)
      .where(eq(assetStatusTransitions.fromStatus, 'available'))
      .run();
    expect(transitionAllowed(ctx.db, 'available', 'retired')).toBe(false);
  });

  it('lists the statuses an asset can be handed out from, in sort order', async () => {
    ctx = await buildTestApp();

    expect(assignableStatuses(ctx.db).map((row) => row.label)).toEqual(['Available', 'Ordered']);

    ctx.db
      .update(assetStatuses)
      .set({ assignableFrom: true })
      .where(eq(assetStatuses.id, 'in_repair'))
      .run();
    expect(assignableStatuses(ctx.db).map((row) => row.label)).toEqual([
      'Available',
      'In repair',
      'Ordered',
    ]);
  });
});
