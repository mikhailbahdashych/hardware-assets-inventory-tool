import type { FastifyInstance } from 'fastify';
import type { Action } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { MemberRow } from '@/types/members.js';
import { resolvePermissions } from '@/services/roles.js';
import { resolveSession, SESSION_COOKIE, setSessionCookie } from '@/services/sessions.js';
import { getSettings } from '@/services/settings.js';

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
    /**
     * What this member's role may do, resolved from the `roles` tables on
     * every request. Empty without a session, and empty for a role that is
     * gone — `requireAction` asks it one question, so the failure mode of any
     * gap is a closed door. This is also why a grant or a revocation lands on
     * the member's next request with no session invalidation machinery.
     */
    permissions: ReadonlySet<Action>;
  }
}

/** Populates request.member from the session cookie on every request. */
export function registerSessionAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('member');
  app.decorateRequest('mustEnrolMfa');
  app.decorateRequest('permissions');

  app.addHook('onRequest', async (request, reply) => {
    request.member = null;
    request.mustEnrolMfa = false;
    request.permissions = new Set();
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const resolved = await resolveSession(deps.db, raw, deps.now());
    if (!resolved) return;
    request.member = resolved.member;
    // The row's expiry slid; the cookie's has to follow, or the browser drops
    // it at sign-in + 30 days however active the member has been. Same helper
    // as sign-in, so the attributes cannot drift — and a logout later in this
    // request still wins, because a later cookie of the same name replaces it.
    if (resolved.slidTo) setSessionCookie(reply, raw, resolved.slidTo, deps.config);
    request.permissions = await resolvePermissions(deps.db, request.member.role);

    // Read from the settings row rather than cached anywhere: an admin turning
    // the requirement on should reach everybody already signed in, on their
    // very next request, without waiting for a session to expire. A session
    // implies setup ran, so a missing row is a broken instance: `getSettings`
    // says so rather than letting it read as "not required".
    const settings = await getSettings(deps.db);
    request.mustEnrolMfa = settings.mfaRequired && request.member.mfaConfirmedAt === null;
  });
}
