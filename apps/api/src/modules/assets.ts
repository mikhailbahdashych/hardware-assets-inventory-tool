import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  assetCreateInput,
  assetPatchInput,
  assignInput,
  checkinInput,
  type AssignInput,
  type CheckinInput,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  createAsset,
  deleteAsset,
  getAssetDetail,
  listAssets,
  nextAssetTag,
  updateAsset,
} from '@/services/assets.js';
import { assignAsset, checkinAsset, currentHolderContact } from '@/services/assignments.js';
import { sendAssignmentMail, sendCheckinMail } from '@/services/transactional.js';
import { removeStoredFiles } from '@/services/attachments.js';

const idParam = z.object({ id: z.string().min(1) });

/** The two ownership routes' requests, named so their helpers can take them. */
type AssignRequest = FastifyRequest<{ Params: { id: string }; Body: AssignInput }>;
type CheckinRequest = FastifyRequest<{ Params: { id: string }; Body: CheckinInput }>;

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
      const storedNames = deleteAsset(deps, request.member!, request.params.id);
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
      preHandler: requireAction('assets.assign'),
    },
    async (request) => ({
      asset: await handOver(request),
    }),
  );

  typed.post(
    '/api/v1/assets/:id/checkin',
    {
      schema: { params: idParam, body: checkinInput },
      preHandler: requireAction('assets.checkin'),
    },
    async (request) => ({
      asset: await takeBack(request),
    }),
  );

  /**
   * Assign, then tell the assignee if the form asked us to. The mail is sent
   * after the transaction and never inside it: a message cannot be rolled back,
   * and the handover has already happened by the time anyone would read it.
   */
  async function handOver(request: AssignRequest) {
    const asset = assignAsset(deps, request.member!, request.params.id, request.body);
    if (!request.body.notify) return asset;

    const holder = currentHolderContact(deps.db, request.params.id);
    if (holder) {
      await sendAssignmentMail(deps, request.log, {
        to: holder.email,
        assetName: asset.name,
        assetTag: asset.assetTag,
        checkedOutAt: request.body.checkoutDate,
        expectedReturnDate: request.body.expectedReturnDate,
        url: `${deps.config.appUrl}/assets/${asset.id}`,
      });
    }
    return asset;
  }

  /** The holder is read *before* the check-in: afterwards there is not one. */
  async function takeBack(request: CheckinRequest) {
    const holder = request.body.emailConfirmation
      ? currentHolderContact(deps.db, request.params.id)
      : null;
    const asset = checkinAsset(deps, request.member!, request.params.id, request.body);

    if (holder) {
      await sendCheckinMail(deps, request.log, {
        to: holder.email,
        assetName: asset.name,
        assetTag: asset.assetTag,
        returnedAt: request.body.returnDate,
      });
    }
    return asset;
  }
}
