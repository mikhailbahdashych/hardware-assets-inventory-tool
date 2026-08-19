import { afterEach, describe, expect, it } from 'vitest';
import { requireAction } from '@/plugins/rbac.js';
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
    ctx.db.update(members).set({ role: 'viewer' }).run();
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
