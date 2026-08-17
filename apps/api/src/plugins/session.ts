import type { FastifyInstance } from 'fastify';
import type { members } from '@/db/schema.js';
import type { AppDeps } from '@/types/app.js';
import { resolveSession, SESSION_COOKIE } from '@/services/sessions.js';

export type MemberRow = typeof members.$inferSelect;

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
