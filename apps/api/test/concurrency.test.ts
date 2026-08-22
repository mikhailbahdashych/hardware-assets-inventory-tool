import { afterEach, describe, expect, it } from 'vitest';
import { employees } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => ctx.close());

/**
 * The gate in `db/client.ts`, and the reason it is not decoration.
 *
 * `@libsql/client` hands each transaction its own connection, and one SQLite
 * file has one writer — so two transactions started together are two
 * connections racing for the same lock, and the losers block the event loop
 * until the busy timeout and then fail with SQLITE_BUSY. Nothing else in this
 * suite would tell you: driven through `app.inject` the requests happen to
 * take the lock one at a time, so the HTTP case below passes either way. This
 * file exists because the service layer is reachable from the scheduler and
 * the CLIs as well, where nothing arranges that for us.
 */
describe('transactions started together', () => {
  it('all commit, rather than three of them finding the file locked', async () => {
    ctx = await buildTestApp();
    const at = nowIso();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ctx.db.transaction(async (tx) => {
          await tx
            .insert(employees)
            .values({
              id: newId(),
              firstName: `Person${i}`,
              lastName: 'Okafor',
              email: `person${i}@acme.io`,
              status: 'active',
              createdAt: at,
              updatedAt: at,
            })
            .run();
          return i;
        }),
      ),
    );

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(await ctx.db.select().from(employees).all()).toHaveLength(8);
  });

  it('a failing one rolls back alone and lets the queue behind it through', async () => {
    ctx = await buildTestApp();
    const at = nowIso();
    const row = (i: number) => ({
      id: newId(),
      firstName: `Person${i}`,
      lastName: 'Okafor',
      email: `person${i}@acme.io`,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });

    const results = await Promise.allSettled([
      ctx.db.transaction(async (tx) => tx.insert(employees).values(row(1)).run()),
      ctx.db.transaction(async () => {
        throw new Error('this one changes its mind');
      }),
      ctx.db.transaction(async (tx) => tx.insert(employees).values(row(2)).run()),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(await ctx.db.select().from(employees).all()).toHaveLength(2);
  });

  it('and the same over HTTP, where the two requests really are in flight at once', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/employees',
          cookie,
          body: { firstName: `Person${i}`, lastName: 'Okafor', email: `person${i}@acme.io` },
        }),
      ),
    );

    expect(responses.map((res) => res.statusCode)).toEqual([200, 200, 200, 200]);
    expect(await ctx.db.select().from(employees).all()).toHaveLength(4);
  });
});
