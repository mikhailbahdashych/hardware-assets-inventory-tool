import type { FastifyInstance } from 'fastify';
import type { Config } from '@/types/config.js';
import { AppError } from '@/lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF stance: no tokens. The app is strictly same-origin (no CORS is
 * registered anywhere), cookies are SameSite=Lax, and this guard rejects any
 * mutating request whose Origin/Referer is not APP_URL's origin exactly.
 * Browsers always send Origin on cross-site mutations; requests without
 * either header are non-browser clients (curl) and pass.
 *
 * APP_URL is the only thing compared against. The guard used to also accept an
 * origin matching the request's own Host header, which read as tolerance for a
 * misconfigured APP_URL — but Host is whatever the caller typed, so that arm
 * accepted every attacker who set both headers to their own domain, and it did
 * so precisely on the instances where APP_URL was wrong and this guard was
 * therefore the only check left standing. A wrong APP_URL now fails loudly at
 * the first mutation instead, which is what the 403 message says; the startup
 * warning in index.ts names the same variable.
 *
 * Skipped in development: the Vite dev server proxies /api and forwards the
 * browser's Origin (http://localhost:5173), which would never match.
 */
export function registerOriginGuard(app: FastifyInstance, config: Config): void {
  if (config.nodeEnv === 'development') return;
  const appOrigin = new URL(config.appUrl).origin;

  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;

    // Not a default: browsers send one header or the other, and either one
    // answers the same question — where did this request come from?
    const source = request.headers.origin ?? request.headers.referer;
    if (!source) return;

    let origin: string;
    try {
      origin = new URL(source).origin;
    } catch {
      throw new AppError(403, 'bad_origin', 'Request origin could not be parsed.');
    }

    if (origin !== appOrigin) {
      throw new AppError(
        403,
        'bad_origin',
        `Cross-origin requests are not allowed. If this request came from the app itself, ` +
          `APP_URL is misconfigured — this instance expects ${appOrigin}.`,
      );
    }
  });
}
