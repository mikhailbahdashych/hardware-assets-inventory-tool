import type { FastifyInstance } from 'fastify';
import type { Config } from '@/config.js';
import { AppError } from '@/lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF stance: no tokens. The app is strictly same-origin (no CORS is
 * registered anywhere), cookies are SameSite=Lax, and this guard rejects any
 * mutating request whose Origin/Referer points elsewhere. Browsers always
 * send Origin on cross-site mutations; requests without either header are
 * non-browser clients (curl) and pass.
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

    const hostOrigins = request.headers.host
      ? [`http://${request.headers.host}`, `https://${request.headers.host}`]
      : [];
    if (origin !== appOrigin && !hostOrigins.includes(origin)) {
      throw new AppError(403, 'bad_origin', 'Cross-origin requests are not allowed.');
    }
  });
}
