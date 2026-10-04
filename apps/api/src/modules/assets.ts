import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ASSIGNED_STATUS,
  assetCreateInput,
  assetPatchInput,
  assignInput,
  checkinInput,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAnyAction, requireAuth } from '@/plugins/rbac.js';
import { forbidden } from '@/lib/errors.js';
import { assetListQuery } from '@/lib/search.js';
import {
  createAsset,
  deleteAsset,
  getAssetDetail,
  listAssets,
  nextAssetTag,
  updateAsset,
} from '@/services/assets.js';
import { assignAsset, checkinAsset } from '@/services/assignments.js';
import { removeStoredFiles } from '@/services/attachments.js';

const idParam = z.object({ id: z.string().min(1) });

// The list is paged and searched here, not in the browser — see `assetListQuery`
// in `lib/search.ts` and the pagination note in apps/api/CLAUDE.md.

export function registerAssetRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/v1/assets',
    { schema: { querystring: assetListQuery }, preValidation: requireAuth },
    async (request) => listAssets(deps.db, request.query),
  );

  typed.get(
    '/api/v1/assets/next-tag',
    { preValidation: requireAction('assets.create') },
    async () => ({ assetTag: await nextAssetTag(deps.db) }),
  );

  typed.get(
    '/api/v1/assets/:id',
    { schema: { params: idParam }, preValidation: requireAuth },
    async (request) => getAssetDetail(deps.db, request.params.id),
  );

  // Creating an asset already assigned is a handover too, so it needs the
  // grant a handover needs — the body says which, so the handler asks.
  typed.post(
    '/api/v1/assets',
    { schema: { body: assetCreateInput }, preValidation: requireAction('assets.create') },
    async (request) => {
      if (request.body.status === ASSIGNED_STATUS && !request.permissions.has('assets.assign')) {
        throw forbidden();
      }
      return { asset: await createAsset(deps, request.member!, request.body) };
    },
  );

  /**
   * Two grants share this door. Moving the status is `assets.change_status` —
   * the Roles page's box and the detail page's button — and every other key is
   * `assets.edit`. The guard refuses a caller holding neither before the body
   * is validated; the handler asks for `assets.edit` once it can see a key that
   * needs it, and the service asks for `assets.change_status` against the row
   * it read, because only that row says whether a sent status is a move — the
   * edit form resends the status it was opened with on every save.
   */
  typed.patch(
    '/api/v1/assets/:id',
    {
      schema: { params: idParam, body: assetPatchInput },
      preValidation: requireAnyAction('assets.edit', 'assets.change_status'),
    },
    async (request) => {
      const editsMore = Object.keys(request.body).some((key) => key !== 'status');
      if (editsMore && !request.permissions.has('assets.edit')) throw forbidden();
      return {
        asset: await updateAsset(deps, request.member!, request.params.id, request.body, {
          mayChangeStatus: request.permissions.has('assets.change_status'),
        }),
      };
    },
  );

  typed.delete(
    '/api/v1/assets/:id',
    { schema: { params: idParam }, preValidation: requireAction('assets.delete') },
    async (request, reply) => {
      const storedNames = await deleteAsset(deps, request.member!, request.params.id);
      await removeStoredFiles(deps, storedNames);
      return reply.status(204).send();
    },
  );

  // Handing an asset over and taking it back are operations, not edits: they
  // open and close ownership records, which no PATCH may do.
  typed.post(
    '/api/v1/assets/:id/assign',
    {
      schema: { params: idParam, body: assignInput },
      preValidation: requireAction('assets.assign'),
    },
    // The holder's inbox copy is written inside the service's transaction.
    async (request) => ({
      asset: await assignAsset(deps, request.member!, request.params.id, request.body),
    }),
  );

  typed.post(
    '/api/v1/assets/:id/checkin',
    {
      schema: { params: idParam, body: checkinInput },
      preValidation: requireAction('assets.checkin'),
    },
    async (request) => ({
      asset: await checkinAsset(deps, request.member!, request.params.id, request.body),
    }),
  );
}
