import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  acceptInviteInput,
  forgotPasswordInput,
  loginInput,
  mfaChallengeInput,
  resetPasswordInput,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { members, orgSettings, sessions } from '@/db/schema.js';
import { AppError, invalidCredentials, invalidToken } from '@/lib/errors.js';
import { nowIso } from '@/lib/dates.js';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from '@/lib/password.js';
import { serializeMember } from '@/lib/serialize.js';
import { requireSession } from '@/plugins/rbac.js';
import { writeAudit } from '@/services/audit.js';
import { consumeToken, findValidToken, issueAuthToken } from '@/services/auth-tokens.js';
import { requireRole } from '@/services/roles.js';
import { replenishRecoveryCodes, verifyChallenge } from '@/services/mfa.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie,
  SESSION_COOKIE,
} from '@/services/sessions.js';

// Attempt caps per IP; the login handler additionally verifies a dummy hash
// for unknown emails so timing never reveals whether an account exists.
const LOGIN_RATE = { max: 10, timeWindow: 15 * 60 * 1000 };
const TOKEN_RATE = { max: 10, timeWindow: 60 * 60 * 1000 };
const FORGOT_RATE = { max: 5, timeWindow: 60 * 60 * 1000 };

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/api/v1/auth/login',
    { schema: { body: loginInput }, config: { rateLimit: LOGIN_RATE } },
    async (request, reply) => {
      const now = deps.now();
      const [member] = await deps.db
        .select()
        .from(members)
        .where(eq(members.email, request.body.email));

      // Deliberate, and the reason this endpoint is safe: an unknown email
      // still pays for one argon2 verify, so timing never reveals whether an
      // account exists. The dummy hash is the point, not a fallback.
      const hash = member?.passwordHash ?? (await DUMMY_HASH_PROMISE);
      const valid = await verifyPassword(hash, request.body.password);
      if (!member || !member.passwordHash || !valid || member.status !== 'active') {
        throw invalidCredentials();
      }

      // A confirmed authenticator means the password is only half of it. The
      // session is not created here at all — the caller gets a short-lived
      // challenge token and has to come back with a code for it.
      if (member.mfaConfirmedAt) {
        return {
          mfaRequired: true,
          challengeToken: await issueAuthToken(deps.db, member.id, 'mfa_challenge', now),
        };
      }

      await writeAudit(
        deps.db,
        {
          type: 'auth',
          action: 'auth.login',
          actorMemberId: member.id,
          actorName: member.displayName,
          memberId: member.id,
        },
        now,
      );
      const session = await createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    },
  );

  /**
   * The second half of a login. Takes the challenge token the password step
   * returned and either an authenticator code or a recovery code — the server
   * decides which by what matches, so the screen needs one input.
   *
   * Rate-limited like the password step: a six-digit code is a million
   * possibilities, which is only enough if guessing is slow.
   */
  typed.post(
    '/api/v1/auth/mfa/verify',
    { schema: { body: mfaChallengeInput }, config: { rateLimit: LOGIN_RATE } },
    async (request, reply) => {
      const now = deps.now();
      const token = await findValidToken(
        deps.db,
        request.body.challengeToken,
        'mfa_challenge',
        now,
      );
      if (!token) throw invalidToken();

      const [member] = await deps.db.select().from(members).where(eq(members.id, token.memberId));
      if (!member || member.status !== 'active') throw invalidCredentials();

      // One transaction for everything the code buys: the recovery code it
      // spends, the challenge it consumes, the sign-in it records — and, for
      // somebody who has just run out, a fresh set with the line that says so.
      const recoveryCodes = await deps.db.transaction(async (tx) => {
        if (!(await verifyChallenge(tx, member, request.body.code, now))) {
          // The challenge survives a wrong code — a mistyped digit should not
          // send somebody back to the password screen — and the rate limit is
          // what stops that being useful to anybody else.
          throw new AppError(422, 'mfa_code_invalid', 'That code is not right.');
        }

        await consumeToken(tx, token.id, now);
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'auth.login',
            actorMemberId: member.id,
            actorName: member.displayName,
            memberId: member.id,
          },
          now,
        );

        const codes = await replenishRecoveryCodes(tx, member, now);
        if (codes) {
          await writeAudit(
            tx,
            {
              type: 'auth',
              action: 'member.mfa_codes_regenerated',
              // The member themselves: nobody asked for this, the sign-in did.
              actorMemberId: member.id,
              actorName: member.displayName,
              memberId: member.id,
              params: { memberName: member.displayName },
            },
            now,
          );
        }
        return codes;
      });

      const session = await createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      // `recoveryCodes` is absent on every ordinary sign-in, and present
      // exactly once when a set was minted: this response is the only place
      // those codes will ever exist in readable form.
      return recoveryCodes
        ? { member: serializeMember(member), recoveryCodes }
        : { member: serializeMember(member) };
    },
  );

  typed.post('/api/v1/auth/logout', {}, async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) await deleteSession(deps.db, raw);
    clearSessionCookie(reply, deps.config);
    return reply.status(204).send();
  });

  // Without SMTP there is nothing to send; the response is 204 either way so
  // the endpoint can never be used to probe which emails exist. Recovery
  // without SMTP: an admin issues a copyable reset link from the Members page.
  typed.post(
    '/api/v1/auth/forgot-password',
    { schema: { body: forgotPasswordInput }, config: { rateLimit: FORGOT_RATE } },
    async (_request, reply) => reply.status(204).send(),
  );

  typed.post(
    '/api/v1/auth/reset-password',
    { schema: { body: resetPasswordInput }, config: { rateLimit: TOKEN_RATE } },
    async (request, reply) => {
      const now = deps.now();
      const token = await findValidToken(deps.db, request.body.token, 'password_reset', now);
      if (!token) throw invalidToken();
      const passwordHash = await hashPassword(request.body.newPassword);

      const member = await deps.db.transaction(async (tx) => {
        await tx
          .update(members)
          .set({ passwordHash, updatedAt: nowIso(now) })
          .where(eq(members.id, token.memberId));
        await consumeToken(tx, token.id, now);
        const updated = (await tx.select().from(members).where(eq(members.id, token.memberId)))[0]!;
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'auth.password_reset',
            actorMemberId: updated.id,
            actorName: updated.displayName,
            memberId: updated.id,
          },
          now,
        );
        await tx.delete(sessions).where(eq(sessions.memberId, updated.id));
        return updated;
      });

      const session = await createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    },
  );

  typed.get(
    '/api/v1/auth/invite/:token',
    { schema: { params: z.object({ token: z.string() }) } },
    async (request) => {
      const token = await findValidToken(deps.db, request.params.token, 'invite', deps.now());
      if (!token) throw invalidToken();
      const [member] = await deps.db.select().from(members).where(eq(members.id, token.memberId));
      if (!member || member.status !== 'invited') throw invalidToken();
      // An invite can only exist once setup has run, so the settings row is
      // always there. Naming an unnamed organization would be the bug.
      const [settings] = await deps.db.select().from(orgSettings);
      if (!settings) {
        throw new AppError(
          500,
          'not_initialized',
          'This instance has no organization settings, so the invite cannot be described.',
        );
      }
      // The label as well as the id: this route is unauthenticated, so the
      // accept page has no way to fetch /roles and find out what the role a
      // workspace made up is called.
      return {
        email: member.email,
        role: member.role,
        roleLabel: (await requireRole(deps.db, member.role)).label,
        orgName: settings.orgName,
      };
    },
  );

  typed.post(
    '/api/v1/auth/accept-invite',
    { schema: { body: acceptInviteInput }, config: { rateLimit: TOKEN_RATE } },
    async (request, reply) => {
      const now = deps.now();
      const token = await findValidToken(deps.db, request.body.token, 'invite', now);
      if (!token) throw invalidToken();
      const [invited] = await deps.db.select().from(members).where(eq(members.id, token.memberId));
      if (!invited || invited.status !== 'invited') throw invalidToken();

      const passwordHash = await hashPassword(request.body.password);
      const member = await deps.db.transaction(async (tx) => {
        await tx
          .update(members)
          .set({
            displayName: request.body.name,
            passwordHash,
            status: 'active',
            updatedAt: nowIso(now),
          })
          .where(eq(members.id, invited.id));
        await consumeToken(tx, token.id, now);
        const updated = (await tx.select().from(members).where(eq(members.id, invited.id)))[0]!;
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'member.joined',
            actorMemberId: updated.id,
            actorName: updated.displayName,
            memberId: updated.id,
            // The name arrives with the invitation being accepted — without it
            // the activity log could only say "A member joined".
            params: { memberName: updated.displayName, email: updated.email },
          },
          now,
        );
        return updated;
      });

      const session = await createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    },
  );

  // requireSession, not requireAuth: somebody mid-enrolment still needs to be
  // able to ask who they are — that answer is what puts the setup screen up.
  typed.get('/api/v1/auth/me', { preHandler: requireSession }, async (request) => ({
    member: serializeMember(request.member!),
    // A sibling rather than part of the member: it is a fact about this member
    // *and* this workspace's policy, and a non-admin cannot read settings to
    // work it out for themselves. It is what puts the setup screen up.
    mustEnrolMfa: request.mustEnrolMfa,
    // Likewise a fact about the member and the workspace's roles, resolved by
    // the same call `requireAction` reads — so an affordance the web draws and
    // the door the API opens can never disagree. Sorted, because a payload
    // whose order wobbles makes every diff of it unreadable.
    permissions: [...request.permissions].sort(),
  }));
}
