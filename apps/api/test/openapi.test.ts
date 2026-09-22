import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API_SCOPES } from '@inventory/shared';
import pkg from '../package.json';
import { buildTestApp, publicRoutes, type TestApp } from './helpers.js';

// The manual. `public-surface-fence.test.ts` fences the set of doors; this
// fences the description of them, against the same discovery — so a public
// route added later and left out of the document fails here rather than
// silently shipping an endpoint no integrator can find.

const dirs: string[] = [];
let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SPEC_URL = '/api/public/openapi.json';
const DOCS_URL = '/api/public/docs';

/** The document's own doors are not in it; everything else under /v1 must be. */
const DOCUMENTED_PREFIX = '/api/public/v1';

/** `:id` as registered, `{id}` as OpenAPI writes it. */
const specPath = (path: string) => path.replace(/:([^/]+)/g, '{$1}');

/** Loose on purpose: which scope is the route's business, that it says so is this file's. */
const NAMES_A_SCOPE = /Requires the `([a-z-]+:[a-z]+)` scope\./;

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
}

interface Spec {
  openapi: string;
  info: { title: string; version: string };
  components?: { securitySchemes?: Record<string, { type?: string; scheme?: string }> };
  paths: Record<string, Record<string, Operation>>;
}

async function fetchSpec(): Promise<Spec> {
  const res = await ctx.app.inject({ method: 'GET', url: SPEC_URL });
  expect(res.statusCode).toBe(200);
  return res.json() as Spec;
}

describe('the OpenAPI document', () => {
  it('is served anonymously, and is an OpenAPI 3 document for this version', async () => {
    ctx = await buildTestApp();
    const spec = await fetchSpec();

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.version).toBe(pkg.version);
    expect(spec.info.title).toBeTruthy();
  });

  it('declares the Bearer scheme the whole surface is opened with', async () => {
    ctx = await buildTestApp();
    const spec = await fetchSpec();

    expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('describes every public route there is', async () => {
    ctx = await buildTestApp();
    const spec = await fetchSpec();

    // Not a list typed out here: the same route table the fence sweeps. A
    // seventeenth route lands in this expectation the day it is registered.
    const registered = publicRoutes(ctx.app)
      .filter((route) => route.path.startsWith(DOCUMENTED_PREFIX) && route.method !== 'HEAD')
      .map((route) => `${route.method} ${specPath(route.path)}`)
      .sort();

    const documented = Object.entries(spec.paths)
      .flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .sort();

    expect(documented).toEqual(registered);
    expect(registered.length).toBeGreaterThanOrEqual(16);
  });

  it('names the scope and the Bearer requirement on every operation', async () => {
    ctx = await buildTestApp();
    const spec = await fetchSpec();

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const where = `${method.toUpperCase()} ${path}`;
        expect(`${where}: ${operation.summary ?? '(no summary)'}`).not.toContain('(no summary)');
        expect(`${where} tags: ${operation.tags?.length ?? 0}`).toBe(`${where} tags: 1`);
        expect(`${where} security: ${JSON.stringify(operation.security)}`).toBe(
          `${where} security: ${JSON.stringify([{ bearerAuth: [] }])}`,
        );

        const scope = NAMES_A_SCOPE.exec(operation.description ?? '')?.[1];
        expect(`${where} names a scope: ${scope ?? 'none'}`).toBe(
          `${where} names a scope: ${API_SCOPES.some((known) => known === scope) ? scope : 'none'}`,
        );
        expect(scope).toBeDefined();
      }
    }
  });

  it('names the right scope where a reader would check', async () => {
    ctx = await buildTestApp();
    const spec = await fetchSpec();

    expect(spec.paths['/api/public/v1/assets']?.post?.description).toContain('`assets:write`');
    expect(spec.paths['/api/public/v1/audit']?.get?.description).toContain('`audit:read`');
  });
});

describe('the documentation UI', () => {
  it('answers an anonymous caller with a page, and serves its assets', async () => {
    ctx = await buildTestApp();

    const page = await ctx.app.inject({ method: 'GET', url: `${DOCS_URL}/` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('swagger');

    const asset = await ctx.app.inject({
      method: 'GET',
      url: `${DOCS_URL}/static/swagger-initializer.js`,
    });
    expect(asset.statusCode).toBe(200);
  });

  it('wins over the SPA fallback on an instance serving the built app', async () => {
    // The production server answers any unknown GET with index.html, and the
    // docs are only "not unknown" while they are a registered route — this is
    // the one place the two ways of answering a GET are in the same app.
    const dist = mkdtempSync(join(tmpdir(), 'inventory-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    dirs.push(dist);
    ctx = await buildTestApp({ WEB_DIST: dist });

    const docs = await ctx.app.inject({ method: 'GET', url: `${DOCS_URL}/` });
    expect(docs.statusCode).toBe(200);
    expect(docs.body).not.toContain('<div id="root">');

    const spec = await ctx.app.inject({ method: 'GET', url: SPEC_URL });
    expect(spec.json<{ openapi: string }>().openapi).toMatch(/^3\./);
  });

  it('changes nothing for a caller who does hold a token', async () => {
    ctx = await buildTestApp();

    const anonymous = await ctx.app.inject({ method: 'GET', url: SPEC_URL });
    const bearing = await ctx.app.inject({
      method: 'GET',
      url: SPEC_URL,
      headers: { authorization: 'Bearer invt_not-a-real-token' },
    });
    expect(bearing.statusCode).toBe(anonymous.statusCode);
    expect(bearing.body).toBe(anonymous.body);
  });
});
