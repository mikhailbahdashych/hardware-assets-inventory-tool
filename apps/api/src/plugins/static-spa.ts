import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * An inline `<script>`: no `src` attribute, and its body is the capture. The
 * hash a browser checks is over exactly those bytes, so the group must not be
 * trimmed or normalised.
 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

/**
 * In production the API serves the built SPA: static assets plus an
 * index.html fallback for any non-/api GET (client-side routing). Unknown
 * /api routes always get the JSON 404 envelope.
 *
 * The document also carries the Content-Security-Policy. It lives here rather
 * than in a plugin of its own because it is a policy *about this build*: the
 * inline theme script in `index.html` is hashed at registration from the file
 * about to be served, so the script can change without anybody remembering to
 * update a constant, and a build with no inline script simply gets no hash.
 * Serving it here also means development never sees it — Vite serves its own
 * HTML with its own injected scripts — while e2e, which runs the production
 * build, exercises every journey under the enforced policy.
 */
export async function registerStaticSpa(app: FastifyInstance, webDist?: string): Promise<void> {
  const html = webDist === undefined ? null : readIndexHtml(webDist);

  // One fact, two checks: a non-null `html` implies a `webDist`, but only the
  // second half of this says so to the compiler.
  if (html !== null && webDist !== undefined) {
    const headers = securityHeaders(html);
    await app.register(fastifyStatic, {
      root: webDist,
      // Only the document. A policy governs what a *page* may load and
      // execute, and a stylesheet or a JS bundle is not a page — so the
      // header rides with the HTML, which reaches this hook both as
      // /index.html and as the fallback's sendFile below.
      setHeaders: (reply, path) => {
        if (path.endsWith('.html')) reply.headers(headers);
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (html !== null && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
  });
}

/** The built HTML, or null for an instance that serves no SPA (dev, tests). */
function readIndexHtml(webDist: string): string | null {
  const path = join(webDist, 'index.html');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Every directive here is a claim about the built app, not a template:
 *
 * - `script-src` is self plus the hash of each inline script the build left in
 *   the HTML — today exactly one, the pre-paint theme/density script.
 * - `style-src` keeps `'unsafe-inline'` because React writes style attributes,
 *   and the app has ~100 of them; the stylesheets themselves are same-origin
 *   files. `'unsafe-inline'` in a *style* context cannot execute anything.
 * - `img-src` allows `data:` for the enrolment QR code, which `qrcode` renders
 *   to a data URI and hands to an `<img>`.
 * - `font-src` is self plus `data:`, which the browser insisted on: the faces
 *   are @fontsource files in the bundle, but Vite inlines any asset under 4 KB,
 *   and JetBrains Mono's smallest subsets land under it. `'self'` alone blocks
 *   exactly those four and nothing says so except the console. A font does not
 *   execute; a font CDN is what this app forbids, and none is allowed here.
 * - `connect-src 'self'` — the SPA talks to this origin and nothing else.
 * - `frame-ancestors 'none'` (plus the older `X-Frame-Options` for anything
 *   that predates it) is the clickjacking half; `object-src`, `base-uri` and
 *   `form-action` close the injection paths a policy is expected to close.
 */
function securityHeaders(html: string): Record<string, string> {
  const hashes = [...html.matchAll(INLINE_SCRIPT)].map(
    // The capture group is non-optional in a matched result.
    (match) => `'sha256-${createHash('sha256').update(match[1]!).digest('base64')}'`,
  );
  return {
    'content-security-policy': [
      "default-src 'self'",
      ["script-src 'self'", ...hashes].join(' '),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'x-frame-options': 'DENY',
  };
}
