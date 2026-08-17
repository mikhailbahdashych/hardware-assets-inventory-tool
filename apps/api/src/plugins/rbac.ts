import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Action, type Role } from '@inventory/shared';
import { forbidden, unauthorized } from '@/lib/errors.js';

/** Route preHandler: any signed-in member. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.member) throw unauthorized();
}

/**
 * Route preHandler: member whose role allows the action (see
 * packages/shared/src/rbac.ts — the single permission truth).
 */
export function requireAction(action: Action) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.member) throw unauthorized();
    if (!can(request.member.role as Role, action)) throw forbidden();
  };
}
