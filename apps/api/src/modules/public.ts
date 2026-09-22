import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  assetCreateInput,
  assetPatchInput,
  assignInput,
  checkinInput,
  employeeCreateInput,
  employeePatchInput,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Actor } from '@/types/audit.js';
import { requireScope } from '@/plugins/bearer.js';
import { assetListQuery, listQuery } from '@/lib/search.js';
import {
  createAsset,
  deleteAsset,
  getAssetDetail,
  listAssets,
  updateAsset,
} from '@/services/assets.js';
import { assignAsset, checkinAsset } from '@/services/assignments.js';
import { removeStoredFiles } from '@/services/attachments.js';
import { auditCsv, auditExportQuery, auditPage, auditQuery } from '@/services/audit-log.js';
import { listCustomFields } from '@/services/custom-fields.js';
import {
  createEmployee,
  deleteEmployee,
  getEmployeeDetail,
  listEmployees,
  updateEmployee,
} from '@/services/employees.js';
import { getWorkflow } from '@/services/workflow.js';

/**
 * The public surface: a curated, versioned contract for server-to-server
 * callers, authenticated by Bearer token and by nothing else.
 *
 * It exists apart from `/api/v1` on purpose. The internal API is the SPA's
 * private contract and changes whenever a screen does; this one is a promise.
 * It is also a smaller attack surface by construction — `/auth`, `/members`,
 * `/mfa`, `/setup` and `/workspace/*` simply do not exist here, so accounts and
 * security stay humans-only whatever a token holds.
 *
 * Three rules hold for every route below:
 *
 * 1. **Thin handlers.** Each one calls the exact service and serializer its
 *    internal twin calls, validated by the exact same zod schema — imported,
 *    never re-declared. A public route that computed anything of its own would
 *    be a second implementation of the product, drifting from the first.
 * 2. **`requireScope`, never `requireAction`.** A member's reads are open and
 *    only mutations are declared; a token has no such baseline, so every read
 *    it may perform is granted by name.
 * 3. **The actor is the token.** See {@link actorOf} — an API token is an actor
 *    with no member row.
 *
 * And one mechanical rule that is easy to get wrong: the guard is attached as
 * **`preValidation`, never `preHandler`**. A route-level `preHandler` runs
 * *after* schema validation, so an anonymous caller posting junk to a guarded
 * route would read 422 with the field errors rather than 401 — the request
 * shapes of a door they cannot open. `preValidation` runs before a word of the
 * request is validated, so every route here refuses the same way whatever its
 * method carries. `test/public-surface-fence.test.ts` sweeps the registered
 * route table and fails if any door answers anything but 401.
 */
const V1 = '/api/public/v1';

const idParam = z.object({ id: z.string().min(1) });

/**
 * The token, as the audit log attributes its work. `id` is null because there
 * is no member behind it, and the name is the one the admin gave the token —
 * chosen for exactly this line, so "Assigned MacBook Pro to Maya — Deploy bot"
 * reads the way an activity log should.
 *
 * `request.apiToken!` for the same reason routes write `request.member!`: the
 * preValidation on every one of these routes is `requireScope`, which throws
 * unless it is there.
 */
function actorOf(request: FastifyRequest): Actor {
  return {
    id: null,
    displayName: request.apiToken!.name,
    // Which token, so the log can answer "everything this one did" and, through
    // the kind derived from it, "everything any token did" forever after.
    apiTokenId: request.apiToken!.id,
  };
}

export function registerPublicRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // ---- assets:read ----

  typed.get(
    `${V1}/assets`,
    { schema: { querystring: assetListQuery }, preValidation: requireScope('assets:read') },
    async (request) => listAssets(deps.db, request.query),
  );

  typed.get(
    `${V1}/assets/:id`,
    { schema: { params: idParam }, preValidation: requireScope('assets:read') },
    async (request) => getAssetDetail(deps.db, request.params.id),
  );

  // ---- assets:write ----

  typed.post(
    `${V1}/assets`,
    { schema: { body: assetCreateInput }, preValidation: requireScope('assets:write') },
    async (request) => ({ asset: await createAsset(deps, actorOf(request), request.body) }),
  );

  typed.patch(
    `${V1}/assets/:id`,
    {
      schema: { params: idParam, body: assetPatchInput },
      preValidation: requireScope('assets:write'),
    },
    async (request) => ({
      asset: await updateAsset(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  typed.delete(
    `${V1}/assets/:id`,
    { schema: { params: idParam }, preValidation: requireScope('assets:write') },
    async (request, reply) => {
      const storedNames = await deleteAsset(deps, actorOf(request), request.params.id);
      await removeStoredFiles(deps, storedNames);
      return reply.status(204).send();
    },
  );

  // ---- assignments:write ----

  typed.post(
    `${V1}/assets/:id/assign`,
    {
      schema: { params: idParam, body: assignInput },
      preValidation: requireScope('assignments:write'),
    },
    async (request) => ({
      asset: await assignAsset(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  typed.post(
    `${V1}/assets/:id/checkin`,
    {
      schema: { params: idParam, body: checkinInput },
      preValidation: requireScope('assignments:write'),
    },
    async (request) => ({
      asset: await checkinAsset(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  // ---- employees:read ----

  typed.get(
    `${V1}/employees`,
    { schema: { querystring: listQuery }, preValidation: requireScope('employees:read') },
    async (request) => listEmployees(deps.db, request.query),
  );

  typed.get(
    `${V1}/employees/:id`,
    { schema: { params: idParam }, preValidation: requireScope('employees:read') },
    async (request) => getEmployeeDetail(deps.db, request.params.id),
  );

  // ---- employees:write ----

  typed.post(
    `${V1}/employees`,
    { schema: { body: employeeCreateInput }, preValidation: requireScope('employees:write') },
    async (request) => ({ employee: await createEmployee(deps, actorOf(request), request.body) }),
  );

  typed.patch(
    `${V1}/employees/:id`,
    {
      schema: { params: idParam, body: employeePatchInput },
      preValidation: requireScope('employees:write'),
    },
    async (request) => ({
      employee: await updateEmployee(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  typed.delete(
    `${V1}/employees/:id`,
    { schema: { params: idParam }, preValidation: requireScope('employees:write') },
    async (request, reply) => {
      await deleteEmployee(deps, actorOf(request), request.params.id);
      return reply.status(204).send();
    },
  );

  // ---- workflow:read and custom-fields:read ----

  typed.get(`${V1}/workflow`, { preValidation: requireScope('workflow:read') }, async () =>
    getWorkflow(deps.db),
  );

  typed.get(
    `${V1}/custom-fields`,
    { preValidation: requireScope('custom-fields:read') },
    async () => ({ customFields: await listCustomFields(deps.db) }),
  );

  // ---- audit:read ----

  typed.get(
    `${V1}/audit`,
    { schema: { querystring: auditQuery }, preValidation: requireScope('audit:read') },
    async (request) => auditPage(deps.db, request.query),
  );

  typed.get(
    `${V1}/audit/export`,
    { schema: { querystring: auditExportQuery }, preValidation: requireScope('audit:read') },
    async (request, reply) => {
      const day = deps.now().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="activity-log-${day}.csv"`)
        .send(await auditCsv(deps.db, request.query.type));
    },
  );
}
