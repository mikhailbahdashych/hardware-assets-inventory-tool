import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Action } from '@inventory/shared';
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
 * Route preValidation: a member whose role grants the action. The set was
 * resolved from the `roles` tables when the session was (see
 * `plugins/session.ts`), so this is a lookup rather than a query, and a
 * permission an admin revoked a second ago is already gone from it.
 *
 * All three guards here are attached as **`preValidation`**, never
 * `preHandler`, the same rule `requireScope` follows on the public surface.
 * They read only what the session hook resolved at `onRequest` — the member,
 * the enrolment flag, the permission set — never the body, so they can run
 * before it is validated. On `preHandler` they ran after, and an anonymous
 * caller posting junk read back 422 with the zod field errors: the shape of a
 * request they could never have sent.
 */
export function requireAction(action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Composed, not re-implemented. `requireAction` guards every write and
    // every admin surface in the app, so a check it does not inherit is a
    // check that covers almost nothing — the enrolment gate lived only on the
    // read-only routes until this line existed, which meant a password-only
    // session could still switch two-factor off and wipe everybody's secrets.
    await requireAuth(request, reply);
    if (!request.permissions.has(action)) throw forbidden();
  };
}

/**
 * Route preValidation for a door that more than one grant opens, where which
 * one a request needs depends on its body — `PATCH /assets/:id`, whose status
 * key is `assets.change_status` and every other key `assets.edit`. The body is
 * not parsed yet, so this answers only the question it can: a caller holding
 * none of them is refused here, before validation, exactly as
 * {@link requireAction} would; the handler then asks for the specific grant
 * once it knows what the body carries.
 */
export function requireAnyAction(...actions: [Action, ...Action[]]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);
    if (!actions.some((action) => request.permissions.has(action))) throw forbidden();
  };
}
