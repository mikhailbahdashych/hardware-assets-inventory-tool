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

  it('adds no headers at all to an instance serving no SPA', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
