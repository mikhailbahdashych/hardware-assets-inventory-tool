import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, publicRoutes, registeredRoutes, setupOrg, type TestApp } from './helpers.js';

// `public-api.test.ts` fences the doors; this fences the *set* of doors.
//
// The Bearer plugin attaches and never refuses — `requireScope` is what closes
// a route — which is what lets PR 3 serve an OpenAPI document to somebody who
// has no token yet. The cost of that design is that a public route added later
// without a guard is simply open, and every per-route test in the suite would
// go on passing, because none of them knows the route exists.
//
// So this file does not know either. It reads the route table off the app after
// it is built, and requires each door it finds to refuse an anonymous caller
// with the token 401. Openness has to be written down in DELIBERATELY_OPEN
// below, with a reason — never arrived at by forgetting a line.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/**
 * Public routes that are meant to answer without a credential, each mapped to
 * why — and every entry is a decision somebody typed. The third test below
 * refuses to carry one that no longer names a registered route, so this cannot
 * rot into a blanket excuse.
 *
 * The documentation is the whole of it. An integrator reads the manual before
 * they hold a token, so the OpenAPI document and the UI that renders it answer
 * anybody: the spec leaks shapes, not data. `/api/public/docs` is a subtree
 * rather than a page — swagger-ui serves its own bundle — and each of those
 * doors is written out here rather than covered by a prefix, so a swagger-ui
 * upgrade that adds one fails this file and asks somebody to look.
 *
 * One key is not a URL. `printRoutes` draws a wildcard as a bare `*` under the
 * nearest node above it, dropping the `static/` the route actually carries, so
 * the sweep reconstructs `/api/public/docs/*` for a route that really serves
 * `/api/public/docs/static/*`. The key is what the discovery reports, because
 * that is what the sweep would otherwise go and knock on.
 */
const WHY_THE_MANUAL_IS_OPEN = 'the manual is read before a token is held';
const DELIBERATELY_OPEN: Record<string, string> = {
  '/api/public/openapi.json': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs/': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs/json': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs/yaml': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs/static/index.html': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs/static/swagger-initializer.js': WHY_THE_MANUAL_IS_OPEN,
  '/api/public/docs/*': WHY_THE_MANUAL_IS_OPEN,
};

/** A param has to be *something*; a guard that runs first never looks at it. */
const probeUrl = (path: string) => path.replace(/:[^/]+/g, 'fence-probe');

describe('the set of public doors', () => {
  /**
   * The fence is only worth having if the reading works, and the reading parses
   * a drawing. These assertions are the tripwire: if a fastify upgrade changes
   * the tree's shape, this fails loudly here instead of quietly discovering
   * nothing and policing an empty list.
   */
  it('reads the route table off the app, and the reading is sound', async () => {
    ctx = await buildTestApp();
    const all = registeredRoutes(ctx.app);

    // Nested children reassemble into whole paths, and the internal surface
    // parses too — proof the parser is reading the tree and not one flat level.
    expect(all).toContainEqual({ method: 'GET', path: '/api/v1/assets' });
    expect(all).toContainEqual({ method: 'POST', path: '/api/v1/members/:id/reset-link' });

    const paths = new Set(publicRoutes(ctx.app).map((route) => route.path));
    expect(paths).toContain('/api/public/v1/assets');
    expect(paths).toContain('/api/public/v1/assets/:id/checkin');
    expect(paths).toContain('/api/public/v1/audit/export');
    // Not a census of the surface — a floor, so this file can never pass by
    // having found nothing at all. Counted over the *guarded* doors, because
    // the documentation subtree below would otherwise hold the number up on
    // its own.
    const guarded = publicRoutes(ctx.app).filter((route) => !(route.path in DELIBERATELY_OPEN));
    expect(guarded.length).toBeGreaterThanOrEqual(16);
  });

  it('refuses an anonymous caller at every one of them', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    const guarded = publicRoutes(ctx.app).filter((route) => !(route.path in DELIBERATELY_OPEN));

    for (const { method, path } of guarded) {
      const res = await ctx.app.inject({ method, url: probeUrl(path) });
      const door = `${method} ${path}`;
      // Named in the expectation rather than asserted bare, so a failure says
      // which door stood open instead of only that one did.
      expect(`${door} → ${res.statusCode}`).toBe(`${door} → 401`);
      // HEAD carries no body to read a code out of; every other method must
      // refuse as the *token* door. A public route guarded with `requireAuth`
      // by mistake would answer 401 `unauthorized` here and be caught, because
      // a cookie is not a credential this surface accepts.
      if (method !== 'HEAD') {
        expect(`${door} → ${res.json().error.code}`).toBe(`${door} → invalid_token`);
      }
    }
  });

  it('carries no entry for a route that is not there', async () => {
    ctx = await buildTestApp();
    const paths = new Set(publicRoutes(ctx.app).map((route) => route.path));

    for (const [path, why] of Object.entries(DELIBERATELY_OPEN)) {
      expect(`${path} is registered (open because: ${why})`).toBe(
        `${paths.has(path) ? path : `${path} — NOT REGISTERED`} is registered (open because: ${why})`,
      );
    }
  });
});
