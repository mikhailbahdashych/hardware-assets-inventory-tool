import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, setupOrg, type TestApp } from './helpers.js';

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

const PUBLIC_PREFIX = '/api/public/';

/**
 * Public routes that are meant to answer without a credential, each mapped to
 * why. Integrators read the documentation before they hold a token, so PR 3's
 * `/api/public/docs` and `/api/public/openapi.json` belong here when they land
 * — the spec leaks shapes, not data.
 *
 * It is empty today, and that is the point: every entry is a decision somebody
 * typed, and the fence below refuses to carry one that no longer names a
 * registered route, so this cannot rot into a blanket excuse.
 */
const DELIBERATELY_OPEN: Record<string, string> = {};

interface RegisteredRoute {
  /**
   * Taken off `inject` itself rather than fastify's `HTTPMethods`: the two are
   * different unions, and this one is the one the sweep has to hand back.
   */
  method: NonNullable<InjectOptions['method']>;
  /** As registered, `:id` params and all. */
  path: string;
}

/**
 * Every route the built app actually has, read out of fastify's own tree.
 *
 * `printRoutes` draws a tree: four columns of box-drawing per level, then the
 * path segment this node adds, then its methods in brackets if it serves any.
 * Reassembling a full path is therefore concatenating the segments on the stack
 * down to this line's depth. A node with no methods is a branch — it still goes
 * on the stack, it just contributes no route of its own.
 */
function registeredRoutes(app: FastifyInstance): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];
  const segments: string[] = [];

  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const marker = line.trimEnd().indexOf('── ');
    if (marker === -1) continue;
    // The path starts at column `marker + 3`, and each level is four columns
    // wide, so that column *is* the depth. Top level starts at column 4.
    const depth = (marker + 3) / 4 - 1;
    const rest = line.trimEnd().slice(marker + 3);

    const methodsAt = rest.lastIndexOf(' (');
    segments[depth] = methodsAt === -1 ? rest : rest.slice(0, methodsAt);
    segments.length = depth + 1;
    if (methodsAt === -1) continue;

    const path = segments.join('');
    for (const method of rest.slice(methodsAt + 2, -1).split(', ')) {
      // Fastify printed them, so they are methods fastify serves; the cast
      // says that rather than widening the field to a bare string.
      found.push({ method: method as RegisteredRoute['method'], path });
    }
  }
  return found;
}

const publicRoutes = (app: FastifyInstance) =>
  registeredRoutes(app).filter((route) => route.path.startsWith(PUBLIC_PREFIX));

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
    // having found nothing at all.
    expect(publicRoutes(ctx.app).length).toBeGreaterThanOrEqual(16);
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
