import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import type { MemberRow } from '@/types/members.js';
import { orgSettings } from '@/db/schema.js';
import { resolveSession, SESSION_COOKIE } from '@/services/sessions.js';

// The augmentation stays here rather than moving to `src/types/`: it is
// ambient, and it only takes effect because this module is imported for its
// side effect (`registerSessionAuth` below). A types file nobody imports at
// runtime would still be compiled, but keeping the declaration next to the hook
// that fills `request.member` is what makes the two impossible to separate.
declare module 'fastify' {
  interface FastifyRequest {
    member: MemberRow | null;
    /**
     * The workspace requires a second factor and this member has not confirmed
     * one. Resolved once per request beside the member, so `requireAuth` is a
     * field read rather than a settings query on every route.
     */
    mustEnrolMfa: boolean;
  }
}

/** Populates request.member from the session cookie on every request. */
export function registerSessionAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('member');
  app.decorateRequest('mustEnrolMfa');

  app.addHook('onRequest', async (request) => {
    request.member = null;
    request.mustEnrolMfa = false;
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    request.member = resolveSession(deps.db, raw, deps.now());
    if (!request.member) return;

    // Read from the settings row rather than cached anywhere: an admin turning
    // the requirement on should reach everybody already signed in, on their
    // very next request, without waiting for a session to expire.
    const settings = deps.db.select().from(orgSettings).get();
    request.mustEnrolMfa = settings?.mfaRequired === true && request.member.mfaConfirmedAt === null;
  });
}
