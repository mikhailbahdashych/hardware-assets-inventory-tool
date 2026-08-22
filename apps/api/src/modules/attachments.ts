import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '@/types/app.js';
import { attachments } from '@/db/schema.js';
import { AppError, notFound } from '@/lib/errors.js';
import { serializeAttachment, saveAttachment, deleteAttachment } from '@/services/attachments.js';
import { ObjectNotStored } from '@/services/storage.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';

const idParam = z.object({ id: z.string().min(1) });

/** Invoices and warranty paperwork, on /data or in the bucket that replaced it. */
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
      const [row] = await deps.db
        .select()
        .from(attachments)
        .where(eq(attachments.id, request.params.id));
      if (!row) throw notFound('That attachment');

      // Open the bytes before a single header is set. Setting content-type
      // first and letting the stream fail leaves the error handler unable to
      // serialise its envelope under that type, so the client gets a raw
      // Fastify internal instead of `{ error: { … } }` — and the web client
      // cannot render a message for a shape it never sees. A row without its
      // object is real: a restore without `uploads/`, or the best-effort
      // remove in services/attachments.ts racing a delete.
      let body: Readable;
      try {
        body = await deps.storage.stream(row.storedName);
      } catch (error) {
        if (error instanceof ObjectNotStored) throw notFound('That attachment');
        throw error;
      }

      // Always a download, never rendered: an uploaded file must not be able
      // to run as a page in the app's own origin. And always through here,
      // whichever driver holds the bytes — a presigned URL would hand the
      // browser a link that outlives the session and carries none of these
      // headers, which is why they are a deliberate cut rather than an
      // optimisation waiting to be made.
      return reply
        .header('content-type', 'application/octet-stream')
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        )
        .send(body);
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
