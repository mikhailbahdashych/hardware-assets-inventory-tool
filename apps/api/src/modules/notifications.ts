import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '@/types/app.js';
import { requireAuth } from '@/plugins/rbac.js';
import {
  DEFAULT_INBOX_LIMIT,
  listNotifications,
  markAllRead,
  MAX_INBOX_LIMIT,
} from '@/services/notifications.js';

const inboxQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_INBOX_LIMIT).default(DEFAULT_INBOX_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

/** The bell: every member has an inbox; nothing here needs a permission. */
export function registerNotificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/v1/notifications',
    { schema: { querystring: inboxQuery }, preHandler: requireAuth },
    async (request) =>
      listNotifications(deps.db, request.member!.id, request.query.limit, request.query.offset),
  );

  app.post('/api/v1/notifications/read', { preHandler: requireAuth }, async (request, reply) => {
    await markAllRead(deps.db, request.member!.id, deps.now());
    return reply.status(204).send();
  });
}
