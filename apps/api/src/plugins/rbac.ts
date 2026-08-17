import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Action, type Role } from '@inventory/shared';
import { AppError, forbidden, unauthorized } from '@/lib/errors.js';

/**
 * Two guards, because enrolment has to be reachable from inside the state it
 * exits. {@link requireSession} is "signed in", full stop — the enrolment
 * endpoints and `/auth/me` use it, so the web app can see where it stands.
 * {@link requireAuth} is "signed in and done with setup", which is what every
 * other route wants.
 *
 * When the workspace requires a second factor and this member has not
 * confirmed one, the only things they may reach are the enrolment endpoints
 * (which set their own guard) and signing out. Everything else answers 409
 * `mfa_enrolment_required`, which is what the web app turns into the setup
 * screen. Enforcing it here rather than in each route means a new endpoint is
 * covered by default — the failure mode of forgetting is a locked door, not an
 * open one.
 */
export async function requireSession(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.member) throw unauthorized();
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await requireSession(request, _reply);
  if (request.mustEnrolMfa) {
    throw new AppError(
      409,
      'mfa_enrolment_required',
      'This workspace requires two-factor authentication. Set up an authenticator to continue.',
    );
  }
}

/**
 * Route preHandler: member whose role allows the action (see
 * packages/shared/src/rbac.ts — the single permission truth).
 */
export function requireAction(action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Composed, not re-implemented. `requireAction` guards every write and
    // every admin surface in the app, so a check it does not inherit is a
    // check that covers almost nothing — the enrolment gate lived only on the
    // read-only routes until this line existed, which meant a password-only
    // session could still switch two-factor off and wipe everybody's secrets.
    await requireAuth(request, reply);
    if (!can(request.member!.role as Role, action)) throw forbidden();
  };
}
