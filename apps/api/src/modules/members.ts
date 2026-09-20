import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ADMIN_ROLE, inviteInput, memberPatchInput, setPasswordInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  assertAdminActor,
  inviteMember,
  issueResetLink,
  setMemberPassword,
  listMembers,
  memberById,
  removeMember,
  resendInvite,
  updateMember,
} from '@/services/members.js';
import { writeAudit } from '@/services/audit.js';
import { resetMemberMfa, resetMemberRecoveryCodes } from '@/services/mfa.js';

const idParam = z.object({ id: z.string().min(1) });

/**
 * Members can sign in; employees hold assets (modules/employees.ts). Reading
 * the list is open to every role — the design's Members page is part of the
 * app — but everything that changes an account is admin-only.
 */
export function registerMemberRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/members', { preHandler: requireAuth }, async () => ({
    members: await listMembers(deps.db),
  }));

  typed.post(
    '/api/v1/members/invites',
    { schema: { body: inviteInput }, preHandler: requireAction('members.manage') },
    async (request) => {
      // The link in the response is the whole delivery: whoever invited copies
      // it to the person however the company already talks.
      const result = await inviteMember(deps, request.member!, request.body);
      return result;
    },
  );

  typed.post(
    '/api/v1/members/:id/resend-invite',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => {
      const result = await resendInvite(deps, request.member!, request.params.id);
      return result;
    },
  );

  typed.post(
    '/api/v1/members/:id/reset-link',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => {
      const result = await issueResetLink(deps, request.member!, request.params.id);
      return result;
    },
  );

  /**
   * The blunt recovery: a new password, set outright and handed over out of
   * band. The copyable reset link above is the polite one; this is for the
   * workspace whose people live in a password manager anyway.
   */
  typed.post(
    '/api/v1/members/:id/password',
    {
      schema: { params: idParam, body: setPasswordInput },
      preHandler: requireAction('members.manage'),
    },
    async (request, reply) => {
      await setMemberPassword(deps, request.member!, request.params.id, request.body.newPassword);
      return reply.status(204).send();
    },
  );

  /**
   * Clear somebody's authenticator. Admins only, and there is deliberately no
   * self-service equivalent: a member who could reset their own second factor
   * has a second factor that a stolen password gets past.
   *
   * Allowed on your own account, unlike role changes and removal — locking
   * yourself out is not a way to end up without an admin, and the alternative
   * is telling the only admin to phone themselves.
   */
  typed.post(
    '/api/v1/members/:id/mfa/reset',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request, reply) => {
      const now = deps.now();
      const target = await memberById(deps.db, request.params.id);
      // An admin's second factor is part of the shield around their account.
      if (target.role === ADMIN_ROLE) await assertAdminActor(deps.db, request.member!);
      await deps.db.transaction(async (tx) => {
        await resetMemberMfa(tx, target.id, now);
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'member.mfa_reset',
            actorMemberId: request.member!.id,
            actorName: request.member!.displayName,
            memberId: target.id,
            params: { memberName: target.displayName },
          },
          now,
        );
      });
      return reply.status(204).send();
    },
  );

  /**
   * Empty somebody's recovery codes without touching their authenticator, for
   * the member who has run out or who thinks the list on their desk was read.
   * Their next two-factor sign-in hands them a fresh ten, which is the only way
   * a new set is ever issued.
   *
   * Same guard and the same self-service reasoning as the full reset above —
   * and, unlike it, no session purge: nothing here is un-protected, so signing
   * everybody out would be a punishment for housekeeping.
   */
  typed.post(
    '/api/v1/members/:id/mfa/reset-codes',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request, reply) => {
      const now = deps.now();
      const target = await memberById(deps.db, request.params.id);
      // An admin's second factor is part of the shield around their account.
      if (target.role === ADMIN_ROLE) await assertAdminActor(deps.db, request.member!);
      await deps.db.transaction(async (tx) => {
        await resetMemberRecoveryCodes(tx, target.id);
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'member.mfa_codes_reset',
            actorMemberId: request.member!.id,
            actorName: request.member!.displayName,
            memberId: target.id,
            // The name as it stands, snapshotted. Never a count, never a code.
            params: { memberName: target.displayName },
          },
          now,
        );
      });
      return reply.status(204).send();
    },
  );

  typed.patch(
    '/api/v1/members/:id',
    {
      schema: { params: idParam, body: memberPatchInput },
      preHandler: requireAction('members.manage'),
    },
    async (request) => ({
      member: await updateMember(deps, request.member!, request.params.id, request.body),
    }),
  );

  typed.delete(
    '/api/v1/members/:id',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request, reply) => {
      await removeMember(deps, request.member!, request.params.id);
      return reply.status(204).send();
    },
  );
}
