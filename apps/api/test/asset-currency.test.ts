import { afterEach, describe, expect, it } from 'vitest';
import { assets } from '@/db/schema.js';
import { seedDemo } from '@/db/demo.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

// A price is written in the currency it was entered in. Assets used to store
// NULL — "the workspace default" — so changing that default relabelled every
// price already on file: €2,099 became $2,099 without anybody touching it.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const LAPTOP = { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' };

const setDefault = (cookie: string, defaultCurrency: string) =>
  inject(ctx.app, { method: 'PATCH', url: '/api/v1/settings', cookie, body: { defaultCurrency } });

describe('an asset’s currency', () => {
  it('is the workspace default at the moment it was registered, and stays so', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: { ...LAPTOP, purchasePriceCents: 209900 },
    });
    expect(created.json().asset.currency).toBe('EUR');

    await setDefault(admin, 'USD');
    const read = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${created.json().asset.id}`,
      cookie: admin,
    });
    expect(read.json().asset.currency).toBe('EUR');
  });

  it('keeps one the caller named', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: { ...LAPTOP, currency: 'GBP' },
    });
    expect(created.json().asset.currency).toBe('GBP');
  });

  it('is the default for an imported row that left the column blank', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await setDefault(admin, 'PLN');

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/import/commit',
      cookie: admin,
      body: {
        kind: 'assets',
        rows: [
          { asset_tag: 'AST-1000', name: 'ThinkPad', category: 'Laptops' },
          { asset_tag: 'AST-1001', name: 'Dell', category: 'Monitors', currency: 'EUR' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = new Map(
      (await ctx.db.select().from(assets)).map((row) => [row.assetTag, row.currency]),
    );
    expect(stored.get('AST-1000')).toBe('PLN');
    expect(stored.get('AST-1001')).toBe('EUR');
  });

  it('is written by the demo seed too', async () => {
    ctx = await buildTestApp();
    await seedDemo(ctx.deps, { password: 'Demo-password-1234' });
    const currencies = new Set((await ctx.db.select().from(assets)).map((row) => row.currency));
    expect([...currencies]).toEqual(['EUR']);
  });
});
