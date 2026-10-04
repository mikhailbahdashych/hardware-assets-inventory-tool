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
import { getWorkflow } from '@/services/workflow.js';

/**
 * How large an import body may be, so a file can reach the schema's own cap of
 * 5,000 rows. Fastify's default is 1 MiB, which refused an honest file at
 * around 4,500 rows with a 413 the wizard could not explain. The arithmetic:
 * a row is at most twelve canonical columns, and a generous one — every column
 * filled, a sentence of notes, the keys repeated per row as JSON does — is
 * about 1 KiB; 5,000 of those is 5 MiB, doubled for headroom. It is deliberately
 * not sized from the 2,000-character cell bound (12 × 2,000 × 5,000 is 120 MB),
 * which is a bound on what a validator may be handed, not a file anyone has.
 * A 5,001-row file still fits and gets the schema's own refusal, not a 413.
 */
const IMPORT_BODY_LIMIT = 10 * 1024 * 1024;

/**
 * The read-and-move-data endpoints: the dashboard, the CSV import round trip and
 * the export-all file. Grouped because they are the three routes that describe
 * the whole workspace rather than one record in it.
 */
export function registerDataRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/dashboard', { preValidation: requireAuth }, async (request) =>
    dashboardPayload(deps.db, deps.now(), request.permissions.has('audit.view')),
  );

  typed.get(
    '/api/v1/import/template',
    {
      schema: { querystring: z.object({ kind: z.enum(IMPORT_KINDS) }) },
      preValidation: requireAction('import.run'),
    },
    async (request, reply) =>
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${request.query.kind}-template.csv"`)
        // The example rows show this workspace's own statuses: a template
        // naming one it does not have would be a template the app rejects.
        .send(csvTemplate(request.query.kind, (await getWorkflow(deps.db)).statuses)),
  );

  typed.post(
    '/api/v1/import/validate',
    {
      schema: { body: importValidateInput },
      bodyLimit: IMPORT_BODY_LIMIT,
      preValidation: requireAction('import.run'),
    },
    async (request) => ({ report: await validateImport(deps, request.body) }),
  );

  typed.post(
    '/api/v1/import/commit',
    {
      schema: { body: importCommitInput },
      bodyLimit: IMPORT_BODY_LIMIT,
      preValidation: requireAction('import.run'),
    },
    async (request) => commitImport(deps, request.member!, request.body),
  );

  typed.get(
    '/api/v1/export',
    { preValidation: requireAction('export.run') },
    async (_request, reply) => {
      const day = deps.now().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="inventory-export-${day}.json"`)
        .send(JSON.stringify(await workspaceExport(deps.db, deps.now()), null, 2));
    },
  );
}
