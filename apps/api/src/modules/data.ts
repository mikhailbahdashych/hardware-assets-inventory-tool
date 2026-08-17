import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  csvTemplate,
  importCommitInput,
  importValidateInput,
  IMPORT_KINDS,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import { dashboardPayload } from '@/services/dashboard.js';
import { workspaceExport } from '@/services/export.js';
import { commitImport, validateImport } from '@/services/import.js';

/**
 * The read-and-move-data endpoints: the dashboard, the CSV import round trip and
 * the export-all file. Grouped because they are the three routes that describe
 * the whole workspace rather than one record in it.
 */
export function registerDataRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/dashboard', { preHandler: requireAuth }, async () =>
    dashboardPayload(deps.db, deps.now()),
  );

  typed.get(
    '/api/v1/import/template',
    {
      schema: { querystring: z.object({ kind: z.enum(IMPORT_KINDS) }) },
      preHandler: requireAction('import.run'),
    },
    async (request, reply) =>
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${request.query.kind}-template.csv"`)
        .send(csvTemplate(request.query.kind)),
  );

  typed.post(
    '/api/v1/import/validate',
    { schema: { body: importValidateInput }, preHandler: requireAction('import.run') },
    async (request) => ({ report: validateImport(deps, request.body) }),
  );

  typed.post(
    '/api/v1/import/commit',
    { schema: { body: importCommitInput }, preHandler: requireAction('import.run') },
    async (request) => commitImport(deps, request.member!, request.body),
  );

  typed.get(
    '/api/v1/export',
    { preHandler: requireAction('export.run') },
    async (_request, reply) => {
      const day = deps.now().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="inventory-export-${day}.json"`)
        .send(JSON.stringify(workspaceExport(deps.db, deps.now()), null, 2));
    },
  );
}
