import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { inviteInput, memberPatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  inviteMember,
  issueResetLink,
  listMembers,
  memberById,
  removeMember,
  resendInvite,
  updateMember,
} from '@/services/members.js';
import { requireRole } from '@/services/roles.js';
import { sendInviteMail, sendResetMail } from '@/services/transactional.js';
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
      const result = await inviteMember(deps, request.member!, request.body);
      // The link is in the response either way; the email is the convenience.
      if (request.body.sendEmail) {
        await sendInviteMail(deps, request.log, {
          to: result.member.email,
          inviterName: request.member!.displayName,
          // inviteMember has already checked the role exists, in the
          // transaction that stored it.
          roleLabel: (await requireRole(deps.db, result.member.role)).label,
          url: result.inviteUrl,
        });
      }
      return result;
    },
  );

  typed.post(
    '/api/v1/members/:id/resend-invite',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => {
      const result = await resendInvite(deps, request.member!, request.params.id);
      // resendInvite has already 404'd on an unknown id, so this one is there.
      const member = await memberById(deps.db, request.params.id);
      await sendInviteMail(deps, request.log, {
        to: member.email,
        inviterName: request.member!.displayName,
        roleLabel: (await requireRole(deps.db, member.role)).label,
        url: result.inviteUrl,
      });
      return result;
    },
  );

  typed.post(
    '/api/v1/members/:id/reset-link',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => {
      const result = await issueResetLink(deps, request.member!, request.params.id);
      const member = await memberById(deps.db, request.params.id);
      await sendResetMail(deps, request.log, {
        to: member.email,
        url: result.resetUrl,
      });
      return result;
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
