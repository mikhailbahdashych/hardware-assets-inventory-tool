import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ADMIN_ROLE, apiTokenCreateSchema } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { AppError } from '@/lib/errors.js';
import { requireAuth } from '@/plugins/rbac.js';
import { listApiTokens, mintApiToken, revokeApiToken } from '@/services/api-tokens.js';

const idParam = z.object({ id: z.string().min(1) });

/**
 * Managing API tokens is admin-only **by role**, and deliberately not an entry
 * in `ACTIONS`.
 *
 * A grantable `tokens.manage` would rebuild the ladder the admin shield closed:
 * a custom role that can mint an `assets:write` token holds workspace power by
 * proxy, through a credential no session check ever looks at again — and it
 * could hand that power to anybody, including over the accounts that could
 * revoke the grant. So this is not a permission a workspace can give away; it
 * is the one row a workspace cannot edit, asked directly.
 *
 * `assertAdminActor` in `services/members.ts` is the sibling rule, and it reads
 * the role from the database because its callers hold only an `Actor`. Here the
 * member row was resolved from the database on this very request
 * (`plugins/session.ts`), so the field is exactly as fresh: a demotion bites on
 * the demoted member's next request either way.
 */
async function requireAdminRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Composed, never re-implemented — the enrolment gate lives in requireAuth.
  await requireAuth(request, reply);
  if (request.member!.role !== ADMIN_ROLE) {
    throw new AppError(403, 'admin_only', 'Only an admin can manage API tokens.');
  }
}

/**
 * The vault: minting, listing and revoking the credentials that authenticate
 * server-to-server calls. Every rule about the tokens themselves lives in the
 * service; these routes name the guard and hand over the body.
 */
export function registerApiTokenRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/api-tokens', { preHandler: requireAdminRole }, async () => ({
    apiTokens: await listApiTokens(deps.db),
  }));

  /**
   * The only response that ever carries the raw token. Nothing stores it, so
   * an admin who loses it revokes the row and mints another.
   */
  typed.post(
    '/api/v1/api-tokens',
    { schema: { body: apiTokenCreateSchema }, preHandler: requireAdminRole },
    async (request, reply) =>
      reply.status(201).send(await mintApiToken(deps, request.member!, request.body)),
  );

  typed.delete(
    '/api/v1/api-tokens/:id',
    { schema: { params: idParam }, preHandler: requireAdminRole },
    async (request, reply) => {
      await revokeApiToken(deps, request.member!, request.params.id);
      return reply.status(204).send();
    },
  );
}
