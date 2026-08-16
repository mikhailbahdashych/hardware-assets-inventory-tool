import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  acceptInviteInput,
  forgotPasswordInput,
  loginInput,
  resetPasswordInput,
} from '@inventory/shared';
import type { AppDeps } from '../app.js';
import { members, orgSettings, sessions } from '../db/schema.js';
import { invalidCredentials, invalidToken } from '../lib/errors.js';
import { nowIso } from '../lib/dates.js';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from '../lib/password.js';
import { serializeMember } from '../lib/serialize.js';
import { requireAuth } from '../plugins/rbac.js';
import { writeAudit } from '../services/audit.js';
import { consumeToken, findValidToken } from '../services/auth-tokens.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie,
  SESSION_COOKIE,
} from '../services/sessions.js';

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
      const member = deps.db
        .select()
        .from(members)
        .where(eq(members.email, request.body.email))
        .get();

      const hash = member?.passwordHash ?? (await DUMMY_HASH_PROMISE);
      const valid = await verifyPassword(hash, request.body.password);
      if (!member || !member.passwordHash || !valid || member.status !== 'active') {
        throw invalidCredentials();
      }

      writeAudit(
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
      const session = createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    },
  );

  typed.post('/api/v1/auth/logout', {}, async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) deleteSession(deps.db, raw);
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
      const token = findValidToken(deps.db, request.body.token, 'password_reset', now);
      if (!token) throw invalidToken();
      const passwordHash = await hashPassword(request.body.newPassword);

      const member = deps.db.transaction((tx) => {
        tx.update(members)
          .set({ passwordHash, updatedAt: nowIso(now) })
          .where(eq(members.id, token.memberId))
          .run();
        consumeToken(tx, token.id, now);
        const updated = tx.select().from(members).where(eq(members.id, token.memberId)).get()!;
        writeAudit(
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
        tx.delete(sessions).where(eq(sessions.memberId, updated.id)).run();
        return updated;
      });

      const session = createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    },
  );

  typed.get(
    '/api/v1/auth/invite/:token',
    { schema: { params: z.object({ token: z.string() }) } },
    async (request) => {
      const token = findValidToken(deps.db, request.params.token, 'invite', deps.now());
      if (!token) throw invalidToken();
      const member = deps.db.select().from(members).where(eq(members.id, token.memberId)).get();
      if (!member || member.status !== 'invited') throw invalidToken();
      const settings = deps.db.select().from(orgSettings).get();
      return { email: member.email, role: member.role, orgName: settings?.orgName ?? '' };
    },
  );

  typed.post(
    '/api/v1/auth/accept-invite',
    { schema: { body: acceptInviteInput }, config: { rateLimit: TOKEN_RATE } },
    async (request, reply) => {
      const now = deps.now();
      const token = findValidToken(deps.db, request.body.token, 'invite', now);
      if (!token) throw invalidToken();
      const invited = deps.db.select().from(members).where(eq(members.id, token.memberId)).get();
      if (!invited || invited.status !== 'invited') throw invalidToken();

      const passwordHash = await hashPassword(request.body.password);
      const member = deps.db.transaction((tx) => {
        tx.update(members)
          .set({
            displayName: request.body.name,
            passwordHash,
            status: 'active',
            updatedAt: nowIso(now),
          })
          .where(eq(members.id, invited.id))
          .run();
        consumeToken(tx, token.id, now);
        const updated = tx.select().from(members).where(eq(members.id, invited.id)).get()!;
        writeAudit(
          tx,
          {
            type: 'auth',
            action: 'member.joined',
            actorMemberId: updated.id,
            actorName: updated.displayName,
            memberId: updated.id,
          },
          now,
        );
        return updated;
      });

      const session = createSession(deps.db, member.id, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    },
  );

  typed.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request) => ({
    member: serializeMember(request.member!),
  }));
}
