import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors.js';
import { translateUniqueViolation } from '@/lib/unique.js';
import { assets, assignments, employees, members } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => ctx.close());

/**
 * The friendly pre-checks are still the common case's path. This is the other
 * one: the index refused, and the caller has to be told the same thing in the
 * same shape, because a form cannot highlight a field it was told about twice
 * in two different ways.
 */

/** The error the database itself raises, caught rather than described. */
async function violation(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the database to refuse, and it did not');
}

const at = nowIso();

describe('translateUniqueViolation', () => {
  it('answers the asset-tag 422 the create form already shows', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const body = { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' };

    const created = await inject(ctx.app, { method: 'POST', url: '/api/v1/assets', cookie, body });
    const tag = created.json().asset.assetTag as string;

    // What the pre-check answers, over HTTP, with the same tag typed in again.
    const preCheck = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie,
      body: { ...body, assetTag: tag },
    });
    expect(preCheck.statusCode).toBe(422);

    // What the index answers, with nothing in the way of it.
    const translated = translateUniqueViolation(
      await violation(() =>
        ctx.db.insert(assets).values({
          id: newId(),
          assetTag: tag,
          name: 'Another one',
          category: 'laptops',
          status: 'available',
          createdAt: at,
          updatedAt: at,
        }),
      ),
    );

    expect(translated).toBeInstanceOf(AppError);
    expect(translated!.statusCode).toBe(422);
    expect({
      code: translated!.code,
      message: translated!.message,
      fields: translated!.fields,
    }).toEqual(preCheck.json().error);
  });

  it('answers the employee-email 422 the people form already shows', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const body = { firstName: 'Ada', lastName: 'Okafor', email: 'ada@acme.io' };

    expect((await inject(ctx.app, { method: 'POST', url: '/api/v1/employees', cookie, body })).statusCode).toBe(200); // prettier-ignore
    const preCheck = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie,
      body: { ...body, firstName: 'Adaeze' },
    });
    expect(preCheck.statusCode).toBe(422);

    const translated = translateUniqueViolation(
      await violation(() =>
        ctx.db.insert(employees).values({
          id: newId(),
          firstName: 'Adaeze',
          lastName: 'Okafor',
          email: 'ada@acme.io',
          status: 'active',
          createdAt: at,
          updatedAt: at,
        }),
      ),
    );

    expect({
      code: translated!.code,
      message: translated!.message,
      fields: translated!.fields,
    }).toEqual(preCheck.json().error);
  });

  it('answers the member-email 422 the invite form already shows', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const email = 'tomasz@acme.io'; // the account setup created

    const preCheck = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie,
      body: { email, role: 'viewer', employeeId: null, sendEmail: false },
    });
    expect(preCheck.statusCode).toBe(422);

    const translated = translateUniqueViolation(
      await violation(() =>
        ctx.db.insert(members).values({
          id: newId(),
          email,
          displayName: 'Somebody Else',
          passwordHash: null,
          role: 'viewer',
          status: 'invited',
          createdAt: at,
          updatedAt: at,
        }),
      ),
    );

    expect({
      code: translated!.code,
      message: translated!.message,
      fields: translated!.fields,
    }).toEqual(preCheck.json().error);
  });

  it('answers the assign 409 when the ownership index is what refused', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie,
      body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
    });
    const assetId = created.json().asset.id as string;

    // Two open ownership rows for one asset is the shape of two assign
    // requests racing: on SQLite the write lock keeps them apart, on Postgres
    // they both read a free asset and the partial unique index is what stops
    // the second. Either way the caller lost a race — a conflict, not a crash.
    const open = () =>
      ctx.db.insert(assignments).values({
        id: newId(),
        assetId,
        employeeId: null,
        holderNameSnapshot: 'Somebody',
        checkedOutAt: '2026-01-01',
        createdAt: at,
      });
    await open();

    const translated = translateUniqueViolation(await violation(open));
    expect(translated).toBeInstanceOf(AppError);
    expect(translated!.statusCode).toBe(409);
    expect(translated!.code).toBe('asset_unavailable');
  });

  it('says nothing about a constraint it does not know, or an error that is not one', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    expect(translateUniqueViolation(new Error('database is locked'))).toBeNull();
    expect(translateUniqueViolation('not an error at all')).toBeNull();
    expect(translateUniqueViolation(null)).toBeNull();

    // A foreign key is a constraint too, and not this one.
    const foreignKey = await violation(() =>
      ctx.db.insert(assignments).values({
        id: newId(),
        assetId: 'no-such-asset',
        employeeId: null,
        holderNameSnapshot: 'Nobody',
        checkedOutAt: '2026-01-01',
        createdAt: at,
      }),
    );
    expect(translateUniqueViolation(foreignKey)).toBeNull();
  });
});

describe('the error handler renders a translated violation', () => {
  it('answers 422 rather than 500 when an index is the only thing that refused', async () => {
    ctx = await buildTestApp();
    // A route with no pre-check in front of it: the index is the whole story,
    // which is what every writing path looks like under an engine that lets
    // two transactions read the same gap.
    ctx.app.post('/api/v1/_test/duplicate-employee', async () => {
      await ctx.db.insert(employees).values({
        id: newId(),
        firstName: 'Ada',
        lastName: 'Okafor',
        email: 'ada@acme.io',
        status: 'active',
        createdAt: at,
        updatedAt: at,
      });
      return { ok: true };
    });

    const cookie = await setupOrg(ctx.app);
    const first = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/_test/duplicate-employee',
      cookie,
    });
    expect(first.statusCode).toBe(200);

    const second = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/_test/duplicate-employee',
      cookie,
    });
    expect(second.statusCode).toBe(422);
    expect(second.json().error).toEqual({
      code: 'validation',
      message: 'Please correct the highlighted fields.',
      fields: { email: 'Another employee already uses that email address.' },
    });
  });
});
