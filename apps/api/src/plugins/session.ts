import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import type { MemberRow } from '@/types/members.js';
import { resolveSession, SESSION_COOKIE } from '@/services/sessions.js';

// The augmentation stays here rather than moving to `src/types/`: it is
// ambient, and it only takes effect because this module is imported for its
// side effect (`registerSessionAuth` below). A types file nobody imports at
// runtime would still be compiled, but keeping the declaration next to the hook
// that fills `request.member` is what makes the two impossible to separate.
declare module 'fastify' {
  interface FastifyRequest {
    member: MemberRow | null;
  }
}

/** Populates request.member from the session cookie on every request. */
export function registerSessionAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('member');

  app.addHook('onRequest', async (request) => {
    request.member = null;
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    request.member = resolveSession(deps.db, raw, deps.now());
  });
}
