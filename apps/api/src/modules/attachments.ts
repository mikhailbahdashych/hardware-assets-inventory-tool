import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '@/types/app.js';
import { attachments } from '@/db/schema.js';
import { AppError, notFound } from '@/lib/errors.js';
import {
  serializeAttachment,
  saveAttachment,
  deleteAttachment,
  uploadsDir,
} from '@/services/attachments.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';

const idParam = z.object({ id: z.string().min(1) });

/** Invoices and warranty paperwork, stored beside the database on /data. */
export function registerAttachmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/api/v1/assets/:id/attachments',
    {
      schema: { params: idParam },
      preHandler: requireAction('assets.manage_attachments'),
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw new AppError(422, 'validation', 'Choose a file to upload.');

      const row = await saveAttachment(deps, request.member!, request.params.id, {
        filename: file.filename,
        mimetype: file.mimetype,
        stream: file.file,
      });
      return { attachment: serializeAttachment(row, request.member!.displayName) };
    },
  );

  typed.get(
    '/api/v1/attachments/:id',
    { schema: { params: idParam }, preHandler: requireAuth },
    async (request, reply) => {
      const row = deps.db
        .select()
        .from(attachments)
        .where(eq(attachments.id, request.params.id))
        .get();
      if (!row) throw notFound('That attachment');

      // Always a download, never rendered: an uploaded file must not be able
      // to run as a page in the app's own origin.
      return reply
        .header('content-type', 'application/octet-stream')
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        )
        .send(createReadStream(join(uploadsDir(deps), row.storedName)));
    },
  );

  typed.delete(
    '/api/v1/attachments/:id',
    {
      schema: { params: idParam },
      preHandler: requireAction('assets.manage_attachments'),
    },
    async (request, reply) => {
      await deleteAttachment(deps, request.member!, request.params.id);
      return reply.status(204).send();
    },
  );
}
