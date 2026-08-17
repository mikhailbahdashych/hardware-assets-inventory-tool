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
import { sendInviteMail, sendResetMail } from '@/services/transactional.js';

const idParam = z.object({ id: z.string().min(1) });

/**
 * Members can sign in; employees hold assets (modules/employees.ts). Reading
 * the list is open to every role — the design's Members page is part of the
 * app — but everything that changes an account is admin-only.
 */
export function registerMemberRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/members', { preHandler: requireAuth }, async () => ({
    members: listMembers(deps.db),
  }));

  typed.post(
    '/api/v1/members/invites',
    { schema: { body: inviteInput }, preHandler: requireAction('members.manage') },
    async (request) => {
      const result = inviteMember(deps, request.member!, request.body);
      // The link is in the response either way; the email is the convenience.
      if (request.body.sendEmail) {
        await sendInviteMail(deps, request.log, {
          to: result.member.email,
          inviterName: request.member!.displayName,
          role: result.member.role,
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
      const result = resendInvite(deps, request.member!, request.params.id);
      // resendInvite has already 404'd on an unknown id, so this one is there.
      const member = memberById(deps.db, request.params.id);
      await sendInviteMail(deps, request.log, {
        to: member.email,
        inviterName: request.member!.displayName,
        role: member.role,
        url: result.inviteUrl,
      });
      return result;
    },
  );

  typed.post(
    '/api/v1/members/:id/reset-link',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => {
      const result = issueResetLink(deps, request.member!, request.params.id);
      const member = memberById(deps.db, request.params.id);
      await sendResetMail(deps, request.log, { to: member.email, url: result.resetUrl });
      return result;
    },
  );

  typed.patch(
    '/api/v1/members/:id',
    {
      schema: { params: idParam, body: memberPatchInput },
      preHandler: requireAction('members.manage'),
    },
    async (request) => ({
      member: updateMember(deps, request.member!, request.params.id, request.body),
    }),
  );

  typed.delete(
    '/api/v1/members/:id',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request, reply) => {
      removeMember(deps, request.member!, request.params.id);
      return reply.status(204).send();
    },
  );
}
