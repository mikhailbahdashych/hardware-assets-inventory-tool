import { eq } from 'drizzle-orm';
import { DEFAULT_ASSET_STATUSES } from '@inventory/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { assetStatuses, assetStatusTransitions } from '@/db/schema.js';
import { seed } from '@/db/seed.js';
import { emptyWorkspace } from '@/services/workspace.js';
import { buildTestApp, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const statusRows = async () =>
  await ctx.db.select().from(assetStatuses).orderBy(assetStatuses.sortOrder);
const edgeRows = async () => await ctx.db.select().from(assetStatusTransitions);

/**
 * An upgraded instance must behave exactly as it did before the workflow was
 * editable, so the seed is today's six statuses and a full mesh between the
 * five an asset can be moved to directly.
 */
describe('the boot seed lays down today’s workflow', () => {
  it('writes the six default statuses in the default order', async () => {
    ctx = await buildTestApp();
    const rows = await statusRows();

    expect(rows.map((row) => row.id)).toEqual(DEFAULT_ASSET_STATUSES.map((entry) => entry.id));
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const [index, row] of rows.entries()) {
      const expected = DEFAULT_ASSET_STATUSES[index]!;
      expect(row, expected.id).toMatchObject({
        label: expected.label,
        color: expected.color,
        isSystem: expected.isSystem,
        assignableFrom: expected.assignableFrom,
        checkinTarget: expected.checkinTarget,
      });
    }
  });

  it('connects every non-assigned status to every other, and nothing to assigned', async () => {
    ctx = await buildTestApp();
    const edges = await edgeRows();

    // Five statuses an asset moves between directly: 5 × 4 = 20 edges.
    expect(edges).toHaveLength(20);
    for (const edge of edges) {
      expect(edge.fromStatus).not.toBe('assigned');
      expect(edge.toStatus).not.toBe('assigned');
      expect(edge.fromStatus).not.toBe(edge.toStatus);
    }
    expect(new Set(edges.map((edge) => `${edge.fromStatus}→${edge.toStatus}`)).size).toBe(20);
    expect(edges.some((edge) => edge.fromStatus === 'available' && edge.toStatus === 'retired'));
  });

  it('changes nothing when it runs again — it runs at every boot', async () => {
    ctx = await buildTestApp();
    const before = { statuses: await statusRows(), edges: await edgeRows() };

    await seed(ctx.db);
    await seed(ctx.db);

    expect(await statusRows()).toEqual(before.statuses);
    expect(await edgeRows()).toEqual(before.edges);
  });

  it('leaves an edited workflow alone rather than putting a deleted status back', async () => {
    ctx = await buildTestApp();
    await ctx.db.delete(assetStatusTransitions);
    await ctx.db.delete(assetStatuses);
    await ctx.db.insert(assetStatuses).values({
      id: 'on_loan',
      label: 'On loan',
      color: 'info',
      isSystem: false,
      assignableFrom: true,
      checkinTarget: true,
      sortOrder: 0,
      createdAt: '2026-08-17T09:00:00.000Z',
      updatedAt: '2026-08-17T09:00:00.000Z',
    });

    await seed(ctx.db);

    expect((await statusRows()).map((row) => row.id)).toEqual(['on_loan']);
    expect(await edgeRows()).toEqual([]);
  });

  /**
   * The danger zone promises "exactly where a fresh container starts", and a
   * workflow somebody edited is not that. It is also what `seed:demo --reset`
   * runs, so a workflow left standing would make the second reset a different
   * workspace from the first.
   */
  it('comes back to the default after the workspace is emptied', async () => {
    ctx = await buildTestApp();
    await ctx.db.delete(assetStatusTransitions);
    await ctx.db.update(assetStatuses).set({ label: 'In stock' }).where(eq(assetStatuses.id, 'available')); // prettier-ignore

    await emptyWorkspace(ctx.deps);

    expect((await statusRows()).map((row) => row.id)).toEqual(
      DEFAULT_ASSET_STATUSES.map((s) => s.id),
    );
    expect((await statusRows())[0]!.label).toBe('Available');
    expect(await edgeRows()).toHaveLength(20);
  });
});
