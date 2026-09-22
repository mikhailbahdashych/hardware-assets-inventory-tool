import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiScope, ApiTokenCreateInput } from '@inventory/shared';
import { apiTokens, assets, auditEvents, members } from '@/db/schema.js';
import { mintApiToken } from '@/services/api-tokens.js';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

// The door: `/api/public/v1` is reachable with a Bearer token and with nothing
// else. A cookie opens the internal API and not this one, a token opens this
// one and not the internal API, and a mutation that arrives through a token is
// attributed to the token rather than to a member who never made it.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Where the public surface lives, spelled once. */
const P = '/api/public/v1';

const LAPTOP = { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' };

const bearer = (raw: string) => ({ authorization: `Bearer ${raw}` });

/**
 * A token with exactly the reach a test needs. Minted through the real service
 * so the hash, the prefix and the expiry are the ones the door will meet.
 */
async function mint(
  scopes: ApiScope[],
  expiresInDays: ApiTokenCreateInput['expiresInDays'] = 90,
  name = 'Deploy bot',
): Promise<string> {
  const admin = (await ctx.db.select().from(members).where(eq(members.role, 'admin')))[0]!;
  const minted = await mintApiToken(
    ctx.deps,
    { id: admin.id, displayName: admin.displayName },
    { name, scopes, expiresInDays },
  );
  return minted.token;
}

/** A workspace with one asset and one person in it, plus a token for the caller. */
async function workspace(scopes: ApiScope[] = ['assets:read']) {
  const cookie = await setupOrg(ctx.app);
  const employee = (
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie,
      body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io' },
    })
  ).json().employee as { id: string };
  const asset = (
    await inject(ctx.app, { method: 'POST', url: '/api/v1/assets', cookie, body: LAPTOP })
  ).json().asset as { id: string };
  return { cookie, employee, asset, raw: await mint(scopes) };
}

describe('the Bearer door', () => {
  it('turns away a request with no Authorization header at all', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    await mint(['assets:read']);

    // No cookie either — the session plugin has to be fine with that.
    const res = await ctx.app.inject({ method: 'GET', url: `${P}/assets` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_token');
  });

  it('turns away a header it cannot read as a Bearer token', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const raw = await mint(['assets:read']);

    const headers = [
      { authorization: raw }, // the token, but no scheme
      { authorization: `Basic ${raw}` },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
      { authorization: `bearer-${raw}` },
    ];
    for (const header of headers) {
      const res = await inject(ctx.app, { method: 'GET', url: `${P}/assets`, headers: header });
      expect(`${header.authorization} → ${res.statusCode}`).toBe(`${header.authorization} → 401`);
    }
  });

  it('answers an unknown token and an expired one identically', async () => {
    let clock = new Date('2026-03-01T09:00:00.000Z');
    ctx = await buildTestApp({}, () => clock);
    await setupOrg(ctx.app);
    const raw = await mint(['assets:read'], 30);

    const good = await inject(ctx.app, { method: 'GET', url: `${P}/assets`, headers: bearer(raw) });
    expect(good.statusCode).toBe(200);

    clock = new Date('2026-04-02T09:00:00.000Z');
    const expired = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets`,
      headers: bearer(raw),
    });
    const unknown = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets`,
      headers: bearer('invt_nothing-has-this-hash'),
    });

    expect(expired.statusCode).toBe(401);
    // Indistinguishable on purpose: which one it was is not the caller's business.
    expect(expired.json()).toEqual(unknown.json());
    // Refused, never deleted — the row stays on the page with its Expired pill.
    expect(await ctx.db.select().from(apiTokens)).toHaveLength(1);
  });

  it('refuses a cookie session on the public surface, which is what makes it CSRF-immune', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const read = await inject(ctx.app, { method: 'GET', url: `${P}/assets`, cookie: admin });
    expect(read.statusCode).toBe(401);
    expect(read.json().error.code).toBe('invalid_token');

    const write = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets`,
      cookie: admin,
      body: LAPTOP,
    });
    expect(write.statusCode).toBe(401);
    expect(await ctx.db.select().from(assets)).toEqual([]);
  });

  it('grants nothing on the internal surface', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const raw = await mint(['assets:read', 'assets:write']);

    const doors = [
      ['GET', '/api/v1/assets'],
      ['GET', '/api/v1/employees'],
      ['POST', '/api/v1/assets'],
    ] as const;
    for (const [method, url] of doors) {
      const res = await inject(ctx.app, { method, url, headers: bearer(raw), body: LAPTOP });
      expect(`${method} ${url} → ${res.statusCode}`).toBe(`${method} ${url} → 401`);
    }
  });
});

describe('the scope guard', () => {
  it('refuses a write to a token that may only read, and names no other scope', async () => {
    ctx = await buildTestApp();
    const { asset, employee, raw } = await workspace(['assets:read']);

    const doors = [
      ['POST', `${P}/assets`, LAPTOP],
      ['PATCH', `${P}/assets/${asset.id}`, { name: 'Renamed' }],
      ['DELETE', `${P}/assets/${asset.id}`, undefined],
      [
        'POST',
        `${P}/assets/${asset.id}/assign`,
        { employeeId: employee.id, checkoutDate: '2026-03-01' },
      ],
    ] as const;
    for (const [method, url, body] of doors) {
      const res = await inject(ctx.app, { method, url, headers: bearer(raw), body });
      expect(`${method} ${url} → ${res.statusCode}`).toBe(`${method} ${url} → 403`);
      expect(res.json().error.code).toBe('missing_scope');
      // The refusal may name what it wants; it may not inventory what the
      // token holds, which would turn a 403 into a probe.
      expect(res.json().error.message).not.toContain('assets:read');
    }
    expect(await ctx.db.select().from(assets)).toHaveLength(1);
  });

  it('keeps each area behind its own scope', async () => {
    ctx = await buildTestApp();
    const { raw } = await workspace(['assets:read']);

    const closed = [`${P}/employees`, `${P}/workflow`, `${P}/custom-fields`, `${P}/audit`];
    for (const url of closed) {
      const res = await inject(ctx.app, { method: 'GET', url, headers: bearer(raw) });
      expect(`${url} → ${res.statusCode}`).toBe(`${url} → 403`);
      expect(res.json().error.code).toBe('missing_scope');
    }
  });
});

describe('the public surface answers what its internal twin answers', () => {
  it('lists and reads assets, with the paging the internal list takes', async () => {
    ctx = await buildTestApp();
    const { cookie, asset, raw } = await workspace(['assets:read']);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie,
      body: { ...LAPTOP, name: 'Dell U2723QE', category: 'monitors' },
    });

    const listed = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets`,
      headers: bearer(raw),
    });
    const internal = await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(internal.json());
    expect(listed.json().total).toBe(2);
    expect(listed.json().statusCounts).toEqual({ available: 2 });

    // The query the internal list takes is the query this one takes.
    const paged = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets?limit=1&offset=1`,
      headers: bearer(raw),
    });
    expect(paged.json().assets).toHaveLength(1);
    expect(paged.json().total).toBe(2);

    const searched = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets?q=Dell`,
      headers: bearer(raw),
    });
    expect(searched.json().assets).toHaveLength(1);

    const filtered = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets?status=retired`,
      headers: bearer(raw),
    });
    expect(filtered.json().assets).toEqual([]);
    expect(filtered.json().statusCounts).toEqual({ available: 2 });

    const one = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/assets/${asset.id}`,
      headers: bearer(raw),
    });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toEqual(
      (await inject(ctx.app, { method: 'GET', url: `/api/v1/assets/${asset.id}`, cookie })).json(),
    );
  });

  it('creates, edits and deletes an asset', async () => {
    ctx = await buildTestApp();
    const { raw } = await workspace(['assets:write']);

    const created = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets`,
      headers: bearer(raw),
      body: { ...LAPTOP, name: 'ThinkPad X1' },
    });
    expect(created.statusCode).toBe(200);
    const id: string = created.json().asset.id;

    const patched = await inject(ctx.app, {
      method: 'PATCH',
      url: `${P}/assets/${id}`,
      headers: bearer(raw),
      body: { name: 'ThinkPad X1 Carbon' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().asset.name).toBe('ThinkPad X1 Carbon');

    const removed = await inject(ctx.app, {
      method: 'DELETE',
      url: `${P}/assets/${id}`,
      headers: bearer(raw),
    });
    expect(removed.statusCode).toBe(204);
    expect(await ctx.db.select().from(assets).where(eq(assets.id, id))).toEqual([]);
  });

  it('hands an asset over and takes it back', async () => {
    ctx = await buildTestApp();
    const { asset, employee, raw } = await workspace(['assignments:write']);

    const assigned = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets/${asset.id}/assign`,
      headers: bearer(raw),
      body: { employeeId: employee.id, checkoutDate: '2026-03-01' },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().asset.status).toBe('assigned');
    expect(assigned.json().asset.currentHolder.employeeId).toBe(employee.id);

    const back = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets/${asset.id}/checkin`,
      headers: bearer(raw),
      body: { returnDate: '2026-03-08', newStatus: 'available' },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().asset.status).toBe('available');
  });

  it('lists, reads and writes employees', async () => {
    ctx = await buildTestApp();
    const { cookie, employee } = await workspace();
    const read = await mint(['employees:read']);
    const write = await mint(['employees:write']);

    const listed = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/employees?limit=10`,
      headers: bearer(read),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/employees?limit=10', cookie })).json(),
    );

    const one = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/employees/${employee.id}`,
      headers: bearer(read),
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().employee.firstName).toBe('Maya');

    const created = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/employees`,
      headers: bearer(write),
      body: { firstName: 'Tomas', lastName: 'Novak', email: 'tomas@acme.io' },
    });
    expect(created.statusCode).toBe(200);
    const id: string = created.json().employee.id;

    const patched = await inject(ctx.app, {
      method: 'PATCH',
      url: `${P}/employees/${id}`,
      headers: bearer(write),
      body: { department: 'Design' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().employee.department).toBe('Design');

    const removed = await inject(ctx.app, {
      method: 'DELETE',
      url: `${P}/employees/${id}`,
      headers: bearer(write),
    });
    expect(removed.statusCode).toBe(204);
  });

  it('reads the workflow and the custom fields', async () => {
    ctx = await buildTestApp();
    const { cookie } = await workspace();
    const workflow = await mint(['workflow:read']);
    const fields = await mint(['custom-fields:read']);

    const graph = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/workflow`,
      headers: bearer(workflow),
    });
    expect(graph.statusCode).toBe(200);
    expect(graph.json()).toEqual(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/workflow', cookie })).json(),
    );

    const defs = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/custom-fields`,
      headers: bearer(fields),
    });
    expect(defs.statusCode).toBe(200);
    expect(defs.json()).toEqual(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/custom-fields', cookie })).json(),
    );
  });

  it('reads the activity log and exports it as the same file', async () => {
    ctx = await buildTestApp();
    const { cookie, raw } = await workspace(['audit:read']);

    const page = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/audit?limit=5&type=assets`,
      headers: bearer(raw),
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toEqual(
      (
        await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?limit=5&type=assets', cookie })
      ).json(),
    );
    expect(page.json().items.length).toBeLessThanOrEqual(5);

    const file = await inject(ctx.app, {
      method: 'GET',
      url: `${P}/audit/export`,
      headers: bearer(raw),
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(file.headers['content-disposition']).toMatch(
      /^attachment; filename="activity-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(file.body.split('\n')[0]).toBe('Time,Actor,Event,Type');
  });
});

describe('a token is an actor with no member row', () => {
  it('attributes its mutations to the token, and the activity log reads them back', async () => {
    ctx = await buildTestApp();
    const { cookie, asset, employee } = await workspace();
    const raw = await mint(['assignments:write'], 90, 'Deploy bot');

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets/${asset.id}/assign`,
      headers: bearer(raw),
      body: { employeeId: employee.id, checkoutDate: '2026-03-01' },
    });
    expect(res.statusCode).toBe(200);

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'asset.assigned'));
    expect(event!.actorMemberId).toBe(null);
    expect(event!.actorName).toBe('Deploy bot');

    const log = await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?type=assets', cookie });
    const rendered = (log.json().items as { action: string; actorName: string }[]).find(
      (item) => item.action === 'asset.assigned',
    );
    expect(rendered!.actorName).toBe('Deploy bot');
  });

  it('stamps last used the moment the door opens', async () => {
    let clock = new Date('2026-03-01T09:00:00.000Z');
    ctx = await buildTestApp({}, () => clock);
    await setupOrg(ctx.app);
    const raw = await mint(['assets:read']);

    const stamp = async () => (await ctx.db.select().from(apiTokens))[0]!.lastUsedAt;
    expect(await stamp()).toBe(null);

    await inject(ctx.app, { method: 'GET', url: `${P}/assets`, headers: bearer(raw) });
    expect(await stamp()).toBe(clock.toISOString());

    clock = new Date('2026-03-01T10:00:00.000Z');
    await inject(ctx.app, { method: 'GET', url: `${P}/assets`, headers: bearer(raw) });
    expect(await stamp()).toBe(clock.toISOString());
  });
});

describe('the origin guard and the public surface', () => {
  /**
   * A server-to-server caller sends neither Origin nor Referer, which is the
   * arm of the guard that lets curl through — a token mutation must not need a
   * browser's headers.
   */
  it('lets a header-less Bearer mutation through', async () => {
    ctx = await buildTestApp();
    const { raw } = await workspace(['assets:write']);

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets`,
      headers: bearer(raw),
      body: { ...LAPTOP, name: 'ThinkPad X1' },
    });
    expect(res.statusCode).toBe(200);
  });

  /**
   * The guard is registered on the whole app, so it still fires here. It is not
   * what defends this surface — refusing cookies is — but a browser-shaped
   * request with a foreign Origin is turned away before the door is reached.
   */
  it('still refuses a browser-shaped request from somewhere else', async () => {
    ctx = await buildTestApp();
    const { raw } = await workspace(['assets:write']);

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `${P}/assets`,
      headers: { ...bearer(raw), origin: 'https://evil.example' },
      body: { ...LAPTOP, name: 'ThinkPad X1' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  });
});
