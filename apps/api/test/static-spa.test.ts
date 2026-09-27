import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

/** The theme script's shape, not its text: what matters is that it is inline. */
const INLINE_SCRIPT = `
      document.documentElement.dataset.theme = 'dark';
    `;

function writeDist(html: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-dist-'));
  writeFileSync(join(dir, 'index.html'), html);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("built");\n');
  dirs.push(dir);
  return dir;
}

const dirs: string[] = [];
let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const withInlineScript = `<!doctype html>
<html lang="en">
  <head>
    <script>${INLINE_SCRIPT}</script>
    <script type="module" crossorigin src="/assets/app.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

const withoutInlineScript = `<!doctype html>
<html lang="en">
  <head>
    <script type="module" crossorigin src="/assets/app.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

describe('the SPA document carries a content security policy', () => {
  it('hashes every inline script in the built HTML', async () => {
    ctx = await buildTestApp({ WEB_DIST: writeDist(withInlineScript) });
    const expected = `'sha256-${createHash('sha256').update(INLINE_SCRIPT).digest('base64')}'`;

    const res = await ctx.app.inject({ method: 'GET', url: '/index.html' });
    const policy = res.headers['content-security-policy'];
    expect(policy).toContain(`script-src 'self' ${expected}`);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("font-src 'self' data:");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sends the same policy on the client-routing fallback', async () => {
    ctx = await buildTestApp({ WEB_DIST: writeDist(withInlineScript) });
    const expected = `'sha256-${createHash('sha256').update(INLINE_SCRIPT).digest('base64')}'`;

    const res = await ctx.app.inject({ method: 'GET', url: '/assets/AST-0001' });
    expect(res.body).toContain('<div id="root">');
    expect(res.headers['content-security-policy']).toContain(`script-src 'self' ${expected}`);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('carries no hash when the built HTML has no inline script', async () => {
    ctx = await buildTestApp({ WEB_DIST: writeDist(withoutInlineScript) });
    const res = await ctx.app.inject({ method: 'GET', url: '/index.html' });
    const policy = res.headers['content-security-policy'];
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toContain('sha256-');
  });

  it('leaves the API and the assets alone — neither is a document', async () => {
    ctx = await buildTestApp({ WEB_DIST: writeDist(withInlineScript) });

    const api = await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(api.statusCode).toBe(200);
    expect(api.headers['content-security-policy']).toBeUndefined();

    const asset = await ctx.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-security-policy']).toBeUndefined();
  });

  it('serves the app for a client route that merely begins with those letters', async () => {
    ctx = await buildTestApp({ WEB_DIST: writeDist(withInlineScript) });

    // `/api-tokens` and `/api-docs` are pages. A prefix check without the
    // slash swallowed them and answered a bookmark, a hard reload or a pasted
    // link with the JSON 404 envelope — the app opened them fine, so only the
    // URL bar found out. Each is named, so a regression says which page broke.
    for (const url of ['/api-tokens', '/api-docs']) {
      const page = await ctx.app.inject({ method: 'GET', url });
      expect(page.statusCode, url).toBe(200);
      expect(page.body, url).toContain('<div id="root">');
    }

    // The namespace itself is still the API's, and an unknown route under it
    // answers as the API rather than handing a client a page.
    const missing = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');
  });

  it('adds no document headers to an instance serving no SPA', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

// Unlike the policy above, this one rides on everything: a browser that sniffs
// a response into a type it was not sent as can run it as one, and no
// response here — JSON, the document, a bundle, a refusal — wants that.
describe('every response says nosniff', () => {
  it.each([
    ['API JSON', '/api/v1/meta', 200],
    ['the SPA document', '/index.html', 200],
    ['the client-routing fallback', '/assets/AST-0001', 200],
    ['a built asset', '/assets/app.js', 200],
    ['an error envelope', '/api/v1/assets', 401],
  ])('on %s', async (_what, url, status) => {
    ctx = await buildTestApp({ WEB_DIST: writeDist(withInlineScript) });

    const res = await ctx.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    // `toBe`, not `toContain`: one header carrying one value.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
