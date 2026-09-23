import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { jsonSchemaTransform, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  type ApiScope,
  assetCreateInput,
  assetPatchInput,
  assignInput,
  checkinInput,
  employeeCreateInput,
  employeePatchInput,
} from '@inventory/shared';
import pkg from '../../package.json';
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

const DOCS = '/api/public/docs';
const SPEC = '/api/public/openapi.json';

const idParam = z.object({ id: z.string().min(1) });

/**
 * How the document groups the surface: one tag per area, spelled as the first
 * half of the scopes that open it. The type is derived from the value, so
 * naming an area that has no tag is a compile error rather than a heading the
 * UI quietly invents.
 */
const TAGS = [
  { name: 'assets', description: 'Devices, and handing them out.' },
  { name: 'employees', description: 'The people an asset can be handed to.' },
  { name: 'workflow', description: 'The statuses an asset can hold, and the moves between them.' },
  { name: 'custom-fields', description: 'The extra fields this workspace records on an asset.' },
  { name: 'audit', description: 'The activity log.' },
] as const;
type PublicTag = (typeof TAGS)[number]['name'];

/**
 * One route's guard and its entry in the manual, from a single naming of the
 * scope — so the sentence an integrator reads and the door they meet can never
 * say different things.
 *
 * `returns` is prose rather than a response schema, and that is a decision. The
 * request side already has zod schemas that validation and documentation can
 * share; the response side has serializers with no schema behind them, so
 * declaring one would mean writing a second description of every payload — one
 * that drifts from the first the week somebody adds a field, and that fastify
 * would then *serialize through*, silently dropping whatever the twin forgot. A
 * sentence cannot do that.
 */
function documented<S extends object>(
  scope: ApiScope,
  tag: PublicTag,
  summary: string,
  returns: string,
  schema: S,
) {
  return {
    schema: {
      ...schema,
      tags: [tag],
      summary,
      description: `${returns} Requires the \`${scope}\` scope.`,
      security: [{ bearerAuth: [] }],
    },
    preValidation: requireScope(scope),
  };
}

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

/**
 * The whole public surface, inside an encapsulation context of its own.
 *
 * The context is what makes the manual honest. `@fastify/swagger` collects
 * routes through an `onRoute` hook, and a hook only ever sees the context it
 * was registered in and the children below it — so registered *here* it sees
 * these sixteen routes and nothing else, and `/api/v1` cannot leak into a
 * document that is supposed to be a promise. Nothing else changes: the Bearer
 * plugin's hook, the origin guard and the error handler all sit on the root and
 * are inherited, and `printRoutes` draws the whole tree whatever context a
 * route was declared in, which is what the fence reads.
 *
 * The two doors it adds are the only ones on this surface that name no scope,
 * and `test/public-surface-fence.test.ts` carries that decision in writing: an
 * integrator reads the manual before they hold a token, and the spec leaks
 * shapes, not data.
 */
export async function registerPublicRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(async (pub) => {
    await pub.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Inventory public API',
          description:
            'The curated, versioned surface an integration talks to. Mint a token on the ' +
            'API tokens page, send it as `Authorization: Bearer invt_…`, and every endpoint ' +
            'below opens for the scopes that token holds. Cookies are never consulted here; ' +
            'the internal `/api/v1` the app itself uses is not this and is not a contract.',
          version: pkg.version,
        },
        // Relative, because an instance is reached at whatever hostname its
        // operator put in front of it and the app has no business guessing.
        servers: [{ url: '/' }],
        tags: [...TAGS],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              description: 'A token minted on the API tokens page. Shown once, when it is made.',
            },
          },
        },
      },
      // Validation and documentation, one source: the zod schemas the routes
      // are already validated by become the request shapes in the document.
      transform: jsonSchemaTransform,
    });

    registerV1(pub, deps);

    // `hide` keeps the manual's own doors out of the manual: they are how you
    // read it, not something to call.
    pub.get(SPEC, { schema: { hide: true } }, async () => pub.swagger());
    await pub.register(fastifySwaggerUi, { routePrefix: DOCS });
  });
}

function registerV1(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // ---- assets:read ----

  typed.get(
    `${V1}/assets`,
    documented(
      'assets:read',
      'assets',
      'List assets',
      'One page of assets, newest first, each with its current holder. Answers `{assets, total, statusCounts}` — `total` counts the rows behind the filter, `statusCounts` ignores it.',
      { querystring: assetListQuery },
    ),
    async (request) => listAssets(deps.db, request.query),
  );

  typed.get(
    `${V1}/assets/:id`,
    documented(
      'assets:read',
      'assets',
      'Read one asset',
      'Answers `{asset, customFields, history, attachments, auditTrail}` — the ownership history in full and the last 20 events.',
      { params: idParam },
    ),
    async (request) => getAssetDetail(deps.db, request.params.id),
  );

  // ---- assets:write ----

  typed.post(
    `${V1}/assets`,
    documented(
      'assets:write',
      'assets',
      'Create an asset',
      'Answers `{asset}`. An asset created as `assigned` opens its first ownership record in the same transaction, so `assignedToId` is required in that case.',
      { body: assetCreateInput },
    ),
    async (request) => ({ asset: await createAsset(deps, actorOf(request), request.body) }),
  );

  typed.patch(
    `${V1}/assets/:id`,
    documented(
      'assets:write',
      'assets',
      'Edit an asset',
      'Answers `{asset}`. Absent fields are left alone and an explicit `null` clears one. A status move must be an edge this workspace’s workflow has; moving into or out of `assigned` is refused — assign and check in instead.',
      { params: idParam, body: assetPatchInput },
    ),
    async (request) => ({
      asset: await updateAsset(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  typed.delete(
    `${V1}/assets/:id`,
    documented(
      'assets:write',
      'assets',
      'Delete an asset',
      'Answers 204 with no body. An asset somebody is holding is refused — check it in first.',
      { params: idParam },
    ),
    async (request, reply) => {
      const storedNames = await deleteAsset(deps, actorOf(request), request.params.id);
      await removeStoredFiles(deps, storedNames);
      return reply.status(204).send();
    },
  );

  // ---- assignments:write ----

  typed.post(
    `${V1}/assets/:id/assign`,
    documented(
      'assignments:write',
      'assets',
      'Hand an asset to somebody',
      'Answers `{asset}`. Needs an active employee and an asset in a status this workspace marks assignable, with nobody holding it.',
      { params: idParam, body: assignInput },
    ),
    async (request) => ({
      asset: await assignAsset(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  typed.post(
    `${V1}/assets/:id/checkin`,
    documented(
      'assignments:write',
      'assets',
      'Take an asset back',
      'Answers `{asset}`. `newStatus` must be one the workspace marks a check-in target, and the return date may not precede the checkout.',
      { params: idParam, body: checkinInput },
    ),
    async (request) => ({
      asset: await checkinAsset(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  // ---- employees:read ----

  typed.get(
    `${V1}/employees`,
    documented(
      'employees:read',
      'employees',
      'List employees',
      'One page of people, each with how many assets they hold. Answers `{employees, total}`.',
      { querystring: listQuery },
    ),
    async (request) => listEmployees(deps.db, request.query),
  );

  typed.get(
    `${V1}/employees/:id`,
    documented(
      'employees:read',
      'employees',
      'Read one employee',
      'Answers `{employee, holdings, history}` — what they hold now, and what they have given back.',
      { params: idParam },
    ),
    async (request) => getEmployeeDetail(deps.db, request.params.id),
  );

  // ---- employees:write ----

  typed.post(
    `${V1}/employees`,
    documented(
      'employees:write',
      'employees',
      'Create an employee',
      'Answers `{employee}`. Email addresses are lowercased and are unique across the workspace.',
      { body: employeeCreateInput },
    ),
    async (request) => ({ employee: await createEmployee(deps, actorOf(request), request.body) }),
  );

  typed.patch(
    `${V1}/employees/:id`,
    documented(
      'employees:write',
      'employees',
      'Edit an employee',
      'Answers `{employee}`. Absent fields are left alone and an explicit `null` clears one.',
      { params: idParam, body: employeePatchInput },
    ),
    async (request) => ({
      employee: await updateEmployee(deps, actorOf(request), request.params.id, request.body),
    }),
  );

  typed.delete(
    `${V1}/employees/:id`,
    documented(
      'employees:write',
      'employees',
      'Delete an employee',
      'Answers 204 with no body. Somebody still holding an asset is refused; past holdings keep their name so history does not rewrite itself.',
      { params: idParam },
    ),
    async (request, reply) => {
      await deleteEmployee(deps, actorOf(request), request.params.id);
      return reply.status(204).send();
    },
  );

  // ---- workflow:read and custom-fields:read ----

  typed.get(
    `${V1}/workflow`,
    documented(
      'workflow:read',
      'workflow',
      'Read the workflow',
      'Answers `{statuses, transitions}` — the vocabulary every `status` field on this surface is drawn from, and the moves between them. Statuses are rows a workspace edits, not a fixed list.',
      {},
    ),
    async () => getWorkflow(deps.db),
  );

  typed.get(
    `${V1}/custom-fields`,
    documented(
      'custom-fields:read',
      'custom-fields',
      'Read the custom field definitions',
      'Answers `{customFields}` — the keys and types an asset’s `customFields` object may carry.',
      {},
    ),
    async () => ({ customFields: await listCustomFields(deps.db) }),
  );

  // ---- audit:read ----

  typed.get(
    `${V1}/audit`,
    documented(
      'audit:read',
      'audit',
      'Read the activity log',
      'One page of events, newest first, each already rendered to a sentence. Answers `{items, typeCounts, total}`; `typeCounts` covers the whole log, not the page.',
      { querystring: auditQuery },
    ),
    async (request) => auditPage(deps.db, request.query),
  );

  typed.get(
    `${V1}/audit/export`,
    documented(
      'audit:read',
      'audit',
      'Export the activity log',
      'Answers `text/csv` as a download — the same rows through the same renderer the page uses.',
      { querystring: auditExportQuery },
    ),
    async (request, reply) => {
      const day = deps.now().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="activity-log-${day}.csv"`)
        .send(await auditCsv(deps.db, request.query));
    },
  );
}
