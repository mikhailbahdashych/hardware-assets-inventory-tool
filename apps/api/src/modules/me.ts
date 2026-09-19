import { and, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { changePasswordInput, mfaConfirmInput, prefsPatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { authTokens, members, sessions } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { invalidFields } from '@/lib/errors.js';
import { hashPassword, verifyPassword } from '@/lib/password.js';
import { serializeMember } from '@/lib/serialize.js';
import { hashToken } from '@/lib/tokens.js';
import { requireAuth, requireSession } from '@/plugins/rbac.js';
import { writeAudit } from '@/services/audit.js';
import { beginEnrolment, confirmEnrolment } from '@/services/mfa.js';
import { SESSION_COOKIE } from '@/services/sessions.js';
import { getSettings } from '@/services/settings.js';

// The same numbers as `modules/auth.ts`'s TOKEN_RATE: a stolen session must
// not get to brute-force the current password out of this route. Keyed on the
// member — which this route, unlike /auth/login, actually knows — so rotating
// addresses buys no extra guesses and an office NAT shares no bucket. The
// session hook is an instance-level onRequest registered before this plugin,
// so `request.member` is resolved by the time the key is asked for; the ip is
// only ever the key for a request that will 401 anyway.
const PASSWORD_RATE = {
  max: 10,
  timeWindow: 60 * 60 * 1000,
  keyGenerator: (request: FastifyRequest) => request.member?.id ?? request.ip,
};

/** Personal preferences — every role may change their own. */
export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.patch(
    '/api/v1/me/prefs',
    { schema: { body: prefsPatchInput }, preHandler: requireAuth },
    async (request) => {
      const patch: Record<string, string> = {};
      if (request.body.theme) patch.theme = request.body.theme;
      if (request.body.density) patch.density = request.body.density;
      if (request.body.widgets) patch.widgetsJson = JSON.stringify(request.body.widgets);
      patch.updatedAt = nowIso(deps.now());

      await deps.db.update(members).set(patch).where(eq(members.id, request.member!.id));
      const updated = (
        await deps.db.select().from(members).where(eq(members.id, request.member!.id))
      )[0]!;
      return { member: serializeMember(updated) };
    },
  );

  /**
   * The self-service half of password recovery: the signed-in change. The
   * other half stays admin-issued reset links — `/auth/forgot-password` is
   * deliberately inert, and this route is why a member who merely wants a new
   * password never needs an admin at all.
   */
  typed.post(
    '/api/v1/me/password',
    {
      schema: { body: changePasswordInput },
      preHandler: requireAuth,
      config: { rateLimit: PASSWORD_RATE },
    },
    async (request, reply) => {
      const now = deps.now();
      const member = request.member!;
      // An invited member has no hash, but also no password to sign in with —
      // this guard is for the compiler; the wrong-password path is the real one.
      const holds =
        member.passwordHash !== null &&
        (await verifyPassword(member.passwordHash, request.body.currentPassword));
      if (!holds) {
        throw invalidFields({ currentPassword: 'That is not your current password.' });
      }

      const passwordHash = await hashPassword(request.body.newPassword);
      // The session id IS the hashed cookie — that is the storage scheme — so
      // "every session but this one" is a hash away, no request decoration.
      // The `!` holds because requireAuth passed, and plugins/session.ts sets
      // `request.member` from this cookie and nothing else.
      const currentSessionId = hashToken(request.cookies[SESSION_COOKIE]!);
      await deps.db.transaction(async (tx) => {
        await tx
          .update(members)
          .set({ passwordHash, updatedAt: nowIso(now) })
          .where(eq(members.id, member.id));
        // A changed password signs every other browser out; the one that
        // proved it holds the new secret keeps its seat.
        await tx
          .delete(sessions)
          .where(and(eq(sessions.memberId, member.id), ne(sessions.id, currentSessionId)));
        // A pending admin-issued reset link must not outlive the change:
        // whoever holds it could otherwise take the account straight back.
        await tx
          .delete(authTokens)
          .where(
            and(
              eq(authTokens.memberId, member.id),
              eq(authTokens.purpose, 'password_reset'),
              isNull(authTokens.consumedAt),
            ),
          );
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'auth.password_changed',
            actorMemberId: member.id,
            actorName: member.displayName,
            memberId: member.id,
          },
          now,
        );
      });
      return reply.status(204).send();
    },
  );

  /**
   * Start enrolling an authenticator. Reachable while `mfa_enrolment_required`
   * blocks everything else — it is the one thing somebody in that state is
   * allowed to do, and the way out of it.
   */
  typed.post('/api/v1/me/mfa/enroll', { preHandler: requireSession }, async (request) => {
    const settings = await getSettings(deps.db);
    return await beginEnrolment(deps.db, request.member!, settings.orgName, deps.now());
  });

  /**
   * Finish it, against a live code. Returns the recovery codes once — they are
   * stored hashed, so this response is the only time they exist in the clear.
   */
  typed.post(
    '/api/v1/me/mfa/confirm',
    { schema: { body: mfaConfirmInput }, preHandler: requireSession },
    async (request) => {
      const now = deps.now();
      const member = request.member!;
      const recoveryCodes = await confirmEnrolment(deps.db, member, request.body.code, now);
      await writeAudit(
        deps.db,
        {
          type: 'auth',
          action: 'member.mfa_enrolled',
          actorMemberId: member.id,
          actorName: member.displayName,
          memberId: member.id,
          params: { memberName: member.displayName },
        },
        now,
      );
      return { recoveryCodes };
    },
  );
}
