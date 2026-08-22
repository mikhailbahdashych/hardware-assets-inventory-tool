import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AUDIT_TYPES, settingsPatchInput, workspaceDeleteInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction } from '@/plugins/rbac.js';
import { clearSessionCookie } from '@/services/sessions.js';
import { storageUsedBytes } from '@/services/attachments.js';
import { auditCsv, auditPage, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT } from '@/services/audit-log.js';
import { getSettings, updateSettings } from '@/services/settings.js';
import { deleteWorkspace } from '@/services/workspace.js';

const typeFilter = z.enum(AUDIT_TYPES).optional();

const auditQuery = z.object({
  type: typeFilter,
  limit: z.coerce.number().int().min(1).max(MAX_AUDIT_LIMIT).default(DEFAULT_AUDIT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

/** The Admin section: the activity log, workspace settings and the danger zone. */
export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/v1/audit',
    { schema: { querystring: auditQuery }, preHandler: requireAction('audit.view') },
    async (request) => auditPage(deps.db, request.query),
  );

  typed.get(
    '/api/v1/audit/export',
    {
      schema: { querystring: z.object({ type: typeFilter }) },
      preHandler: requireAction('export.run'),
    },
    async (request, reply) => {
      const day = deps.now().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="activity-log-${day}.csv"`)
        .send(await auditCsv(deps.db, request.query.type));
    },
  );

  // `storageUsedBytes` rides beside the row rather than in it: it is a sum over
  // another table, not a column, and PATCH answers with the row alone.
  typed.get('/api/v1/settings', { preHandler: requireAction('settings.manage') }, async () => ({
    settings: await getSettings(deps.db),
    storageUsedBytes: await storageUsedBytes(deps.db),
  }));

  typed.patch(
    '/api/v1/settings',
    { schema: { body: settingsPatchInput }, preHandler: requireAction('settings.manage') },
    async (request) => ({ settings: await updateSettings(deps, request.member!, request.body) }),
  );

  typed.post(
    '/api/v1/workspace/delete',
    { schema: { body: workspaceDeleteInput }, preHandler: requireAction('workspace.delete') },
    async (request, reply) => {
      await deleteWorkspace(deps, request.body.confirmText);
      // Their session went with everything else; clear the cookie so the
      // browser lands on /setup rather than presenting a token nothing knows.
      clearSessionCookie(reply, deps.config);
      return reply.status(204).send();
    },
  );
}
