import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import { requireAuth } from '@/plugins/rbac.js';
import { listNotifications, markAllRead } from '@/services/notifications.js';

/** The bell: every member has an inbox; nothing here needs a permission. */
export function registerNotificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/notifications', { preHandler: requireAuth }, async (request) => {
    return await listNotifications(deps.db, request.member!.id);
  });

  app.post('/api/v1/notifications/read', { preHandler: requireAuth }, async (request, reply) => {
    await markAllRead(deps.db, request.member!.id, deps.now());
    return reply.status(204).send();
  });
}
