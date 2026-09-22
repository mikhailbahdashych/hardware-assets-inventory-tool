import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiTokenCreateInput } from '@inventory/shared';
import { apiTokens, auditEvents, members, rolePermissions } from '@/db/schema.js';
import type { Actor } from '@/types/audit.js';
import { hashToken } from '@/lib/tokens.js';
import {
  listApiTokens,
  mintApiToken,
  resolveApiToken,
  revokeApiToken,
} from '@/services/api-tokens.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

// The vault: an admin mints a named, scoped, optionally expiring token, the
// database keeps only its hash, and the raw value exists exactly once — in the
// response that created it.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const CREATE: ApiTokenCreateInput = {
  name: 'Deploy bot',
  scopes: ['assets:read', 'audit:read'],
  expiresInDays: 90,
};

/** The admin `setupOrg` created, as the services want an actor. */
async function adminActor(): Promise<Actor> {
  const row = (await ctx.db.select().from(members).where(eq(members.role, 'admin')))[0]!;
  return { id: row.id, displayName: row.displayName };
}

/** The workspace granted a manager `members.manage` — the Roles page allows it. */
async function grantedManager(): Promise<string> {
  await ctx.db.insert(rolePermissions).values({ roleId: 'manager', action: 'members.manage' });
  return memberCookie(ctx.db, 'manager');
}

describe('minting a token', () => {
  it('returns the raw value once and stores nothing but its hash', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const actor = await adminActor();

    const minted = await mintApiToken(ctx.deps, actor, CREATE);

    expect(minted.token).toMatch(/^invt_[A-Za-z0-9_-]{43}$/);
    const [row] = await ctx.db.select().from(apiTokens);
    expect(row!.tokenHash).toBe(hashToken(minted.token));
    expect(JSON.stringify(row)).not.toContain(minted.token);
    expect(row!.createdByMemberId).toBe(actor.id);
    expect(row!.createdByName).toBe(actor.displayName);
    expect(JSON.parse(row!.scopes)).toEqual(['assets:read', 'audit:read']);
    expect(minted.apiToken.expiresAt).not.toBe(null);
  });

  it('writes its audit event with the reach and the expiry the admin chose', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    await mintApiToken(ctx.deps, await adminActor(), { ...CREATE, expiresInDays: null });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'token.created'));
    expect(event!.type).toBe('auth');
    expect(JSON.parse(event!.params)).toEqual({
      name: 'Deploy bot',
      scopeCount: 2,
      expiry: 'Unlimited',
    });
  });

  it('leaves an Unlimited token with no expiry at all', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    const minted = await mintApiToken(ctx.deps, await adminActor(), {
      ...CREATE,
      expiresInDays: null,
    });
    expect(minted.apiToken.expiresAt).toBe(null);
  });
});

describe('listing tokens', () => {
  it('never hands back the hash, and never the raw value', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const minted = await mintApiToken(ctx.deps, await adminActor(), CREATE);

    const [summary] = await listApiTokens(ctx.db);
    expect(Object.keys(summary!).sort()).toEqual([
      'createdAt',
      'createdByName',
      'expiresAt',
      'id',
      'lastUsedAt',
      'name',
      'scopes',
    ]);
    expect(JSON.stringify(summary)).not.toContain(minted.token);
    expect(JSON.stringify(summary)).not.toContain(hashToken(minted.token));
  });
});

describe('revoking a token', () => {
  it('takes the row away and says so in the log', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const actor = await adminActor();
    const minted = await mintApiToken(ctx.deps, actor, CREATE);

    await revokeApiToken(ctx.deps, actor, minted.apiToken.id);

    expect(await ctx.db.select().from(apiTokens)).toEqual([]);
    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'token.revoked'));
    expect(JSON.parse(event!.params)).toEqual({ name: 'Deploy bot' });
  });

  it('refuses an id no token has', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    await expect(revokeApiToken(ctx.deps, await adminActor(), 'nope')).rejects.toThrow(
      'could not be found',
    );
  });
});

describe('resolving a raw token', () => {
  it('answers null for anything it has no hash for', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    await mintApiToken(ctx.deps, await adminActor(), CREATE);

    expect(await resolveApiToken(ctx.db, 'invt_not-a-token', new Date())).toBe(null);
    expect(await resolveApiToken(ctx.db, '', new Date())).toBe(null);
  });

  it('answers the token with its reach while it is good', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const minted = await mintApiToken(ctx.deps, await adminActor(), CREATE);

    expect(await resolveApiToken(ctx.db, minted.token, new Date())).toEqual({
      id: minted.apiToken.id,
      name: 'Deploy bot',
      scopes: ['assets:read', 'audit:read'],
    });
  });

  it('refuses one whose window has closed, without deleting the row', async () => {
    const now = new Date('2026-03-01T09:00:00.000Z');
    ctx = await buildTestApp({}, () => now);
    await setupOrg(ctx.app);
    const minted = await mintApiToken(ctx.deps, await adminActor(), {
      ...CREATE,
      expiresInDays: 30,
    });

    const lastGoodMoment = new Date('2026-03-31T08:59:59.000Z');
    expect(await resolveApiToken(ctx.db, minted.token, lastGoodMoment)).not.toBe(null);
    const past = new Date('2026-04-01T09:00:00.000Z');
    expect(await resolveApiToken(ctx.db, minted.token, past)).toBe(null);
    // Still listed, so an integrator can see why their calls stopped working.
    expect(await ctx.db.select().from(apiTokens)).toHaveLength(1);
  });

  it('stamps last used, then holds still for a minute', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const minted = await mintApiToken(ctx.deps, await adminActor(), CREATE);

    const first = new Date('2026-03-01T09:00:00.000Z');
    await resolveApiToken(ctx.db, minted.token, first);
    const stamp = async () => (await ctx.db.select().from(apiTokens))[0]!.lastUsedAt;
    expect(await stamp()).toBe(first.toISOString());

    // A busy integrator must not turn every read into a write.
    await resolveApiToken(ctx.db, minted.token, new Date('2026-03-01T09:00:59.000Z'));
    expect(await stamp()).toBe(first.toISOString());

    const later = new Date('2026-03-01T09:01:00.000Z');
    await resolveApiToken(ctx.db, minted.token, later);
    expect(await stamp()).toBe(later.toISOString());
  });
});

describe('the token routes are admin-only, by role', () => {
  /**
   * The ladder this closes: `members.manage` is a grant any workspace role can
   * hold, and a custom role minting an `assets:write` token would be workspace
   * power by proxy. Token management is therefore not a grantable action at all.
   */
  it('turns away a manager the workspace granted members.manage', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await grantedManager();

    const doors = [
      ['POST', '/api/v1/api-tokens', CREATE],
      ['GET', '/api/v1/api-tokens'],
      ['DELETE', '/api/v1/api-tokens/whatever'],
    ] as const;
    for (const [method, url, body] of doors) {
      const res = await inject(ctx.app, { method, url, cookie: manager, body });
      expect(`${method} ${url} → ${res.statusCode}`).toBe(`${method} ${url} → 403`);
      expect(res.json().error.code).toBe('admin_only');
      expect(res.json().error.message).toBe('Only an admin can manage API tokens.');
    }
  });

  it('turns away a caller with no session at all', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/api-tokens' })).statusCode).toBe(
      401,
    );
  });
});

describe('the token routes, as an admin', () => {
  it('creates, lists and revokes — and shows the raw value exactly once', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const created = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/api-tokens',
      cookie: admin,
      body: CREATE,
    });
    expect(created.statusCode).toBe(201);
    const raw: string = created.json().token;
    expect(raw).toMatch(/^invt_/);
    expect(created.json().apiToken.name).toBe('Deploy bot');
    expect(created.json().apiToken.scopes).toEqual(['assets:read', 'audit:read']);

    const listed = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/api-tokens',
      cookie: admin,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().apiTokens).toHaveLength(1);
    // The one place the raw value ever appeared was the response above.
    expect(listed.body).not.toContain(raw);
    expect(listed.body).not.toContain(hashToken(raw));

    const revoked = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/api-tokens/${created.json().apiToken.id}`,
      cookie: admin,
    });
    expect(revoked.statusCode).toBe(204);
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/api-tokens', cookie: admin })).json()
        .apiTokens,
    ).toEqual([]);
  });

  it('refuses to revoke an id no token has', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: '/api/v1/api-tokens/nope',
      cookie: admin,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('refuses a nameless token, an empty reach, an invented scope and an odd window', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const bodies = [
      { ...CREATE, name: '   ' },
      { ...CREATE, scopes: [] },
      { ...CREATE, scopes: ['members:write'] },
      { ...CREATE, expiresInDays: 45 },
      { name: 'No window', scopes: ['assets:read'] },
    ];
    for (const body of bodies) {
      const res = await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/api-tokens',
        cookie: admin,
        body,
      });
      expect(`${JSON.stringify(body)} → ${res.statusCode}`).toBe(`${JSON.stringify(body)} → 422`);
      expect(res.json().error.code).toBe('validation');
    }
    expect(await ctx.db.select().from(apiTokens)).toEqual([]);
  });
});
