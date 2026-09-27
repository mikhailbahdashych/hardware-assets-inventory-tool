import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, registeredRoutes, setupOrg, type TestApp } from './helpers.js';

// `public-surface-fence.test.ts`'s twin for `/api/v1`, and for a different
// failure. Every internal guard sits on `preValidation`, so an anonymous
// caller meets 401 before a word of the body is validated. Attach one as
// `preHandler` and it runs after zod: an anonymous junk POST reads back 422
// with the field errors — the request shape of a door the caller cannot open —
// and every per-route test goes on passing, because each sends a body it
// already knows is valid.
//
// So this file reads the route table off the built app, knocks on every door
// under `/api/v1/` anonymously with a junk body, and requires 401 with no
// field detail. A route that must answer before sign-in is written down in
// DELIBERATELY_OPEN with its reason — never arrived at by forgetting a guard.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** Routes reachable without a session, each with why. Keys are paths, all methods. */
const DELIBERATELY_OPEN: Record<string, string> = {
  '/api/v1/meta': 'the sign-in and setup screens read the workspace name and whether setup ran',
  '/api/v1/healthz': 'the container health check has no session',
  '/api/v1/setup': 'first-run setup creates the first account, so nobody is signed in yet',
  '/api/v1/auth/login': 'signing in is what makes a session',
  '/api/v1/auth/logout': 'signing out answers 204 whether or not a session was there',
  '/api/v1/auth/mfa/verify': 'the second login step: a challenge token, not a session',
  '/api/v1/auth/reset-password': 'a reset link is the credential, carried in the body',
  '/api/v1/auth/accept-invite': 'an invitation link is the credential, carried in the body',
  '/api/v1/auth/invite/:token': 'the invitation preview: the link is the credential, in the path',
};

/** Wrong for every schema that has fields, and harmless to one that has none. */
const JUNK = { name: 42, email: 7, code: [], token: {}, role: null };

/** A param has to be *something*; a guard that runs first never looks at it. */
const probeUrl = (path: string) => path.replace(/:[^/]+/g, 'fence-probe');

const internalRoutes = (app: TestApp['app']) =>
  registeredRoutes(app).filter((route) => route.path.startsWith('/api/v1/'));

describe('the set of internal doors', () => {
  it('reads the route table, and finds enough of it to mean something', async () => {
    ctx = await buildTestApp();
    const guarded = internalRoutes(ctx.app).filter((route) => !(route.path in DELIBERATELY_OPEN));
    expect(guarded).toContainEqual({ method: 'POST', path: '/api/v1/assets' });
    expect(guarded).toContainEqual({ method: 'POST', path: '/api/v1/members/:id/reset-link' });
    // A floor, not a census: the fence must never pass by finding nothing.
    expect(guarded.length).toBeGreaterThanOrEqual(70);
  });

  it('refuses an anonymous junk request at every guarded one with 401 and no fields', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    const guarded = internalRoutes(ctx.app).filter((route) => !(route.path in DELIBERATELY_OPEN));
    for (const { method, path } of guarded) {
      const carriesBody = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method);
      const res = await ctx.app.inject({
        method,
        url: probeUrl(path),
        ...(carriesBody ? { body: JUNK } : {}),
      });
      const door = `${method} ${path}`;
      // Named in the expectation, so a failure says which door leaked.
      expect(`${door} → ${res.statusCode}`).toBe(`${door} → 401`);
      if (method !== 'HEAD') {
        // The *session* guard's 401, not any 401: a route that refuses for its
        // own reasons (a bogus token in its path) is open, and belongs above.
        const { code, fields } = res.json().error;
        expect(`${door} → ${code}, fields: ${JSON.stringify(fields)}`).toBe(
          `${door} → unauthorized, fields: undefined`,
        );
      }
    }
  });

  it('carries no entry for a route that is not there', async () => {
    ctx = await buildTestApp();
    const paths = new Set(internalRoutes(ctx.app).map((route) => route.path));
    for (const [path, why] of Object.entries(DELIBERATELY_OPEN)) {
      expect(`${path} is registered (open because: ${why})`).toBe(
        `${paths.has(path) ? path : `${path} — NOT REGISTERED`} is registered (open because: ${why})`,
      );
    }
  });
});
