import { afterEach, describe, expect, it } from 'vitest';
import { requireAction } from '@/plugins/rbac.js';
import { loadConfig } from '@/config.js';
import { buildTestApp, inject, setupOrg, SETUP_BODY, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

describe('origin guard', () => {
  it('rejects mutating requests with a foreign Origin', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: 'https://evil.example' },
      body: SETUP_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  });

  // This exact request used to pass: the guard also accepted an origin that
  // matched the Host header, which any caller sets to whatever it likes.
  it('rejects a foreign Origin even when the Host header agrees with it', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: 'https://evil.example', host: 'evil.example' },
      body: SETUP_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  });

  it('names the origin this instance expects, so a wrong APP_URL is diagnosable', async () => {
    ctx = await buildTestApp({ APP_URL: 'https://inventory.acme.io' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: 'http://localhost:3000' },
      body: SETUP_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('APP_URL is misconfigured');
    expect(res.json().error.message).toContain('https://inventory.acme.io');
  });

  it('allows same-origin mutations and all GETs', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: 'http://localhost:3000' },
      body: SETUP_BODY,
    });
    expect(res.statusCode).toBe(200);

    const get = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/meta',
      headers: { origin: 'https://evil.example' },
    });
    expect(get.statusCode).toBe(200);
  });
});

describe('login rate limiting', () => {
  it('returns 429 after 10 attempts from one address', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: 'ghost@acme.io', password: 'wrong-password' },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('RBAC guard', () => {
  it('blocks viewers from admin actions and lets admins through', async () => {
    ctx = await buildTestApp();
    ctx.app.post(
      '/api/v1/_test/admin-only',
      { preHandler: requireAction('settings.manage') },
      async () => ({ ok: true }),
    );
    ctx.app.post(
      '/api/v1/_test/manager-plus',
      { preHandler: requireAction('assets.create') },
      async () => ({ ok: true }),
    );

    const anonymous = await ctx.app.inject({ method: 'POST', url: '/api/v1/_test/admin-only' });
    expect(anonymous.statusCode).toBe(401);

    const adminCookie = await setupOrg(ctx.app);
    const admin = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/_test/admin-only',
      cookie: adminCookie,
    });
    expect(admin.statusCode).toBe(200);

    // Downgrade the admin to viewer and try again.
    const { members } = await import('../src/db/schema.js');
    await ctx.db.update(members).set({ role: 'viewer' });
    const viewerAdminOnly = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/_test/admin-only',
      cookie: adminCookie,
    });
    expect(viewerAdminOnly.statusCode).toBe(403);
    expect(viewerAdminOnly.json().error.code).toBe('forbidden');
    const viewerManagerPlus = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/_test/manager-plus',
      cookie: adminCookie,
    });
    expect(viewerManagerPlus.statusCode).toBe(403);
  });
});

describe('unknown API routes', () => {
  it('returns a JSON 404 envelope under /api', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('rate limiting behind a proxy', () => {
  it('ignores X-Forwarded-For unless the deployment says to trust it', async () => {
    ctx = await buildTestApp();
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { 'x-forwarded-for': `203.0.113.${index}` },
          body: { email: 'nobody@acme.io', password: 'wrong-password-here' },
        }),
      ),
    );
    // Twelve claimed addresses, one real socket: the header buys nothing.
    expect(attempts.filter((res) => res.statusCode === 429).length).toBeGreaterThan(0);
  });

  it('refuses a hop count at boot, naming the migration', () => {
    // fastify 5.12.1 disabled numeric trustProxy (GHSA-3m5p-2c4r-xxw2): a hop
    // count cannot verify the connecting address, so upstream now fails closed
    // — silently trusting nothing. The boot error is what turns that silence
    // into an instruction.
    expect(() => loadConfig({ TRUST_PROXY: '1' })).toThrow(/hop count/i);
    expect(() => loadConfig({ TRUST_PROXY: '2' })).toThrow(/GHSA-3m5p-2c4r-xxw2/);
  });

  it('reads addresses, CIDRs and presets as a list, and keeps the booleans', () => {
    expect(loadConfig({ TRUST_PROXY: '10.0.0.0/16' }).trustProxy).toEqual(['10.0.0.0/16']);
    expect(loadConfig({ TRUST_PROXY: 'loopback, uniquelocal' }).trustProxy).toEqual([
      'loopback',
      'uniquelocal',
    ]);
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('believes the header when the connecting address is a named proxy', async () => {
    // The address-form migration target: app.inject connects from 127.0.0.1,
    // which `loopback` names — so the compiled proxy-addr path is what runs.
    ctx = await buildTestApp({ TRUST_PROXY: 'loopback' });
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { 'x-forwarded-for': `203.0.113.${index}` },
          body: { email: 'nobody@acme.io', password: 'wrong-password-here' },
        }),
      ),
    );
    expect(attempts.every((res) => res.statusCode === 401)).toBe(true);
  });

  it('believes the header once TRUST_PROXY is set, so one client cannot starve the bucket', async () => {
    ctx = await buildTestApp({ TRUST_PROXY: 'true' });
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { 'x-forwarded-for': `203.0.113.${index}` },
          body: { email: 'nobody@acme.io', password: 'wrong-password-here' },
        }),
      ),
    );
    // Twelve distinct clients, each well under the limit.
    expect(attempts.every((res) => res.statusCode === 401)).toBe(true);
  });
});
