import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assetCreateInput, assetPatchInput } from '@inventory/shared';
import type { AppDeps } from '@/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  createAsset,
  deleteAsset,
  getAssetDetail,
  listAssets,
  nextAssetTag,
  updateAsset,
} from '@/services/assets.js';

const idParam = z.object({ id: z.string().min(1) });

/** The whole list is returned in one payload — see the ~10k ceiling in /CLAUDE.md. */
export function registerAssetRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/assets', { preHandler: requireAuth }, async () => ({
    assets: listAssets(deps.db),
  }));

  typed.get(
    '/api/v1/assets/next-tag',
    { preHandler: requireAction('assets.create') },
    async () => ({ assetTag: nextAssetTag(deps.db) }),
  );

  typed.get(
    '/api/v1/assets/:id',
    { schema: { params: idParam }, preHandler: requireAuth },
    async (request) => getAssetDetail(deps.db, request.params.id),
  );

  typed.post(
    '/api/v1/assets',
    { schema: { body: assetCreateInput }, preHandler: requireAction('assets.create') },
    async (request) => ({ asset: createAsset(deps, request.member!, request.body) }),
  );

  typed.patch(
    '/api/v1/assets/:id',
    {
      schema: { params: idParam, body: assetPatchInput },
      preHandler: requireAction('assets.edit'),
    },
    async (request) => ({
      asset: updateAsset(deps, request.member!, request.params.id, request.body),
    }),
  );

  typed.delete(
    '/api/v1/assets/:id',
    { schema: { params: idParam }, preHandler: requireAction('assets.delete') },
    async (request, reply) => {
      deleteAsset(deps, request.member!, request.params.id);
      return reply.status(204).send();
    },
  );
}
