import { afterEach, describe, expect, it } from 'vitest';
import { assetCustomValues, assets, members } from '@/db/schema.js';
import { mintApiToken } from '@/services/api-tokens.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

// A date-only field takes a day the calendar has. `2026-13-45` used to pass the
// shape check on every door, get stored, and throw in the browser's formatter
// on /assets for everybody until somebody fixed the row by hand; `2026-02-30`
// was stored as written and drawn as the 2nd of March.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const LAPTOP = { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' };

async function workspaceWithAsset() {
  const cookie = await setupOrg(ctx.app);
  const created = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: LAPTOP,
  });
  return { cookie, id: created.json().asset.id as string };
}

describe('an impossible date', () => {
  it.each(['2026-13-45', '2026-02-30'])('is refused by PATCH /assets/:id as %s', async (day) => {
    ctx = await buildTestApp();
    const { cookie, id } = await workspaceWithAsset();

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie,
      body: { purchaseDate: day },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.purchaseDate).toBe(
      'That day is not on the calendar — check the month and the day.',
    );
    expect((await ctx.db.select().from(assets))[0]!.purchaseDate).toBeNull();
  });

  it.each(['2026-13-45', '2026-02-30'])('is refused by the public API as %s', async (day) => {
    ctx = await buildTestApp();
    const { id } = await workspaceWithAsset();
    const [admin] = await ctx.db.select().from(members);
    const { token } = await mintApiToken(
      ctx.deps,
      { id: admin!.id, displayName: admin!.displayName },
      { name: 'Deploy bot', scopes: ['assets:write'], expiresInDays: 90 },
    );

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/public/v1/assets/${id}`,
      headers: { authorization: `Bearer ${token}` },
      body: { warrantyUntil: day },
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.db.select().from(assets))[0]!.warrantyUntil).toBeNull();
  });

  it('is reported by the import against its row and column, and nothing is written', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const body = {
      kind: 'assets',
      rows: [
        {
          asset_tag: 'AST-1000',
          name: 'ThinkPad',
          category: 'Laptops',
          purchase_date: '2026-02-30',
        },
      ],
    };

    const dry = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/import/validate',
      cookie,
      body,
    });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().report.errors).toEqual([
      expect.objectContaining({ row: 2, column: 'purchase_date' }),
    ]);

    const commit = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/import/commit',
      cookie,
      body,
    });
    expect(commit.statusCode).not.toBe(200);
    expect(await ctx.db.select().from(assets)).toEqual([]);
  });

  it('leaves a real leap day alone', async () => {
    ctx = await buildTestApp();
    const { cookie, id } = await workspaceWithAsset();

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie,
      body: { purchaseDate: '2024-02-29' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().asset.purchaseDate).toBe('2024-02-29');
  });

  it.each([
    ['2026-13-45', 'That day is not on the calendar — check the month and the day.'],
    ['2026-02-30', 'That day is not on the calendar — check the month and the day.'],
    ['next tuesday', 'Use the format YYYY-MM-DD'],
  ])('is refused as a custom date field value (%s)', async (day, message) => {
    ctx = await buildTestApp();
    const { cookie, id } = await workspaceWithAsset();
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/custom-fields',
      cookie,
      body: { label: 'Leased until', type: 'date' },
    });

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie,
      body: { customValues: { leased_until: day } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields['customValues.leased_until']).toBe(message);
    expect(await ctx.db.select().from(assetCustomValues)).toEqual([]);
  });
});
