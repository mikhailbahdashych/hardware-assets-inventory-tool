import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { statusCreateSchema, statusOrderSchema, statusPatchSchema, transitionsPutSchema } from '@inventory/shared'; // prettier-ignore
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  createStatus,
  deleteStatus,
  getWorkflow,
  reorderStatuses,
  replaceTransitions,
  updateStatus,
} from '@/services/workflow.js';

const idParam = z.object({ id: z.string().min(1) });

/** Where the assets in a deleted status go. Absent means "nothing carries it". */
const deleteQuery = z.object({ migrateTo: z.string().min(1).optional() });

/**
 * The workspace's asset statuses and the moves between them. Everybody reads
 * them — a status pill is unrenderable without the label and colour, and every
 * page draws one — but only an admin may change what the inventory can say
 * about itself. Every rule lives in the workflow service; these routes are the
 * thin layer that names the guard and hands over the body.
 */
export function registerWorkflowRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/workflow', { preHandler: requireAuth }, async () => getWorkflow(deps.db));

  typed.post(
    '/api/v1/workflow/statuses',
    { schema: { body: statusCreateSchema }, preHandler: requireAction('workflow.manage') },
    async (request, reply) =>
      reply.status(201).send({ status: await createStatus(deps, request.member!, request.body) }),
  );

  typed.patch(
    '/api/v1/workflow/statuses/:id',
    {
      schema: { params: idParam, body: statusPatchSchema },
      preHandler: requireAction('workflow.manage'),
    },
    async (request) => ({
      status: await updateStatus(deps, request.member!, request.params.id, request.body),
    }),
  );

  /**
   * Registered before the `:id` routes cannot clash — the methods differ — but
   * it is spelled out here because `order` would otherwise read like a status
   * id to anyone scanning the file.
   */
  typed.put(
    '/api/v1/workflow/statuses/order',
    { schema: { body: statusOrderSchema }, preHandler: requireAction('workflow.manage') },
    async (request) => ({
      statuses: await reorderStatuses(deps, request.member!, request.body.ids),
    }),
  );

  typed.delete(
    '/api/v1/workflow/statuses/:id',
    {
      schema: { params: idParam, querystring: deleteQuery },
      preHandler: requireAction('workflow.manage'),
    },
    async (request, reply) => {
      await deleteStatus(deps, request.member!, request.params.id, request.query.migrateTo);
      return reply.status(204).send();
    },
  );

  typed.put(
    '/api/v1/workflow/transitions',
    { schema: { body: transitionsPutSchema }, preHandler: requireAction('workflow.manage') },
    async (request) => ({
      transitions: await replaceTransitions(deps, request.member!, request.body),
    }),
  );
}
