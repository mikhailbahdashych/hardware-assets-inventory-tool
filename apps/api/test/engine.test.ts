import { eq } from 'drizzle-orm';
import { is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@/config.js';
import { assets, auditEvents } from '@/db/schema.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/**
 * The engine this whole suite is running on. Everything below runs on both —
 * that is the point of the phase — and the one thing that differs is which
 * kind of table object the services were handed.
 */
const ENGINE = process.env.DATABASE_URL ? 'postgres' : 'sqlite';

describe('the engine the environment chose', () => {
  it('is postgres exactly when DATABASE_URL names one', () => {
    expect(loadConfig({}).engine).toBe('sqlite');
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/inv' }).engine).toBe(
      'postgres',
    );
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/inv' }).engine).toBe(
      'postgres',
    );
  });

  it('refuses a DATABASE_URL that is not a postgres one', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://u:p@localhost/inv' })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: 'file:./data/inventory.db' })).toThrow();
  });

  it('hands the services the tables of the dialect it is running', () => {
    // `db/schema.ts` casts the pg tables to the sqlite ones, so the compiler
    // cannot see this. It is the runtime half of that cast being sound.
    expect(is(assets, ENGINE === 'postgres' ? PgTable : SQLiteTable)).toBe(true);
  });
});

describe('a workspace on this engine', () => {
  it('answers the health check', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('creates, reads, edits and deletes an asset, and the log says so', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: admin,
      body: { name: 'ThinkPad X1', category: 'laptops', status: 'available' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().asset.id as string;

    const read = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().asset.name).toBe('ThinkPad X1');

    const edited = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
      body: { name: 'ThinkPad X1 Carbon' },
    });
    expect(edited.statusCode).toBe(200);

    // Booleans survive the round trip as booleans on either engine — pg would
    // otherwise hand a JSON body `"t"` and nothing else would notice.
    const settings = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/settings',
      cookie: admin,
    });
    expect(settings.json().settings.emailInvites).toBe(true);

    const events = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.assetId, id))
      .orderBy(auditEvents.at);
    expect(events.map((event) => event.action)).toEqual(['asset.created', 'asset.updated']);

    const deleted = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/assets/${id}`,
      cookie: admin,
    });
    expect(deleted.statusCode).toBe(204);
    expect(await ctx.db.select().from(assets).where(eq(assets.id, id))).toEqual([]);
  });
});
