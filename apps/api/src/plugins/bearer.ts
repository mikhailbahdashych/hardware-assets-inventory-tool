import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiScope } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { ResolvedApiToken } from '@/types/api-tokens.js';
import { invalidApiToken, missingScope } from '@/lib/errors.js';
import { resolveApiToken } from '@/services/api-tokens.js';

// The augmentation stays beside the hook that fills it, for the reason spelled
// out in `plugins/session.ts`: it is ambient, it only takes effect because this
// module is imported for its side effect, and keeping the two together is what
// makes them impossible to separate.
declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The API token this request arrived with, or null. Resolved only under
     * {@link PUBLIC_PREFIX} — the internal API authenticates members and a
     * Bearer header means nothing there, so a cookie surface never pays for a
     * hash lookup it would not read.
     */
    apiToken: ResolvedApiToken | null;
  }
}

/** Everything behind the Bearer door lives under here. */
const PUBLIC_PREFIX = '/api/public/';

/** `Authorization: Bearer <raw>`, and nothing else counts as one. */
const BEARER = /^Bearer (.+)$/;

/**
 * Resolves `request.apiToken` from the Authorization header on the public
 * surface. It attaches and never refuses: {@link requireScope} is the guard, so
 * a public route that wants no credential at all (the OpenAPI document and its
 * UI) is simply a route that does not name one.
 *
 * Cookies are deliberately not consulted here and not consulted by any public
 * route, which is what makes this surface CSRF-immune by construction rather
 * than by a token somebody has to remember to check.
 */
export function registerBearerAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('apiToken');

  app.addHook('onRequest', async (request) => {
    request.apiToken = null;
    if (!request.url.startsWith(PUBLIC_PREFIX)) return;

    const raw = BEARER.exec(request.headers.authorization ?? '')?.[1]?.trim();
    if (!raw) return;
    request.apiToken = await resolveApiToken(deps.db, raw, deps.now());
  });
}

/**
 * Route **`preValidation`**: a request carrying a live token that holds this
 * scope. The mirror of `requireAction` one layer over — same shape, different
 * vocabulary, because a token's reach is granted by name where a member's reads
 * are open.
 *
 * The lifecycle slot is load-bearing and is the one difference from
 * `requireAction`, which sits on `preHandler`. `preHandler` runs *after* schema
 * validation, so a guard there lets an anonymous caller POST junk and read back
 * 422 with the zod field errors — the request shape of a door they cannot open,
 * and a refusal that says more than "no". Attached at `preValidation` the
 * refusal lands first, and every public route answers 401 identically whatever
 * its method carries.
 */
export function requireScope(scope: ApiScope) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.apiToken) throw invalidApiToken();
    if (!request.apiToken.scopes.includes(scope)) throw missingScope(scope);
  };
}
