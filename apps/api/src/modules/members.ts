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
  removeMember,
  resendInvite,
  updateMember,
} from '@/services/members.js';

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
    async (request) => inviteMember(deps, request.member!, request.body),
  );

  typed.post(
    '/api/v1/members/:id/resend-invite',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => resendInvite(deps, request.member!, request.params.id),
  );

  typed.post(
    '/api/v1/members/:id/reset-link',
    { schema: { params: idParam }, preHandler: requireAction('members.manage') },
    async (request) => issueResetLink(deps, request.member!, request.params.id),
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
