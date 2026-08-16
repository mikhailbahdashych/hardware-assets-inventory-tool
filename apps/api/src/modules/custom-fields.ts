import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { customFieldCreateInput, customFieldPatchInput, toFieldKey } from '@inventory/shared';
import type { AppDeps } from '@/app.js';
import { customFieldDefs } from '@/db/schema.js';
import { invalidFields, notFound } from '@/lib/errors.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import { writeAudit } from '@/services/audit.js';

const idParam = z.object({ id: z.string().min(1) });

const serialize = (def: typeof customFieldDefs.$inferSelect) => ({
  id: def.id,
  key: def.key,
  label: def.label,
  type: def.type,
  sortOrder: def.sortOrder,
});

/**
 * The fields an adopting team adds to describe their own hardware. Everyone
 * reads them — asset forms and detail pages need the definitions — but only
 * admins may change the shape of the inventory.
 */
export function registerCustomFieldRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/custom-fields', { preHandler: requireAuth }, async () => ({
    customFields: deps.db
      .select()
      .from(customFieldDefs)
      .orderBy(customFieldDefs.sortOrder)
      .all()
      .map(serialize),
  }));

  typed.post(
    '/api/v1/custom-fields',
    {
      schema: { body: customFieldCreateInput },
      preHandler: requireAction('custom_fields.manage'),
    },
    async (request) => {
      const now = deps.now();
      const key = toFieldKey(request.body.label);
      if (!key) {
        throw invalidFields({ label: 'Give the field a name with letters or numbers in it.' });
      }

      return deps.db.transaction((tx) => {
        if (tx.select().from(customFieldDefs).where(eq(customFieldDefs.key, key)).get()) {
          throw invalidFields({ label: 'A field with that name already exists.' });
        }

        const id = newId();
        const sortOrder = tx.select().from(customFieldDefs).all().length;
        tx.insert(customFieldDefs)
          .values({
            id,
            key,
            label: request.body.label,
            type: request.body.type,
            sortOrder,
            createdAt: nowIso(now),
          })
          .run();
        writeAudit(
          tx,
          {
            type: 'system',
            action: 'custom_field.created',
            actorMemberId: request.member!.id,
            actorName: request.member!.displayName,
            params: { key, label: request.body.label, fieldType: request.body.type },
          },
          now,
        );

        return {
          customField: serialize(
            tx.select().from(customFieldDefs).where(eq(customFieldDefs.id, id)).get()!,
          ),
        };
      });
    },
  );

  typed.patch(
    '/api/v1/custom-fields/:id',
    {
      schema: { params: idParam, body: customFieldPatchInput },
      preHandler: requireAction('custom_fields.manage'),
    },
    async (request) => {
      const now = deps.now();

      return deps.db.transaction((tx) => {
        const current = tx
          .select()
          .from(customFieldDefs)
          .where(eq(customFieldDefs.id, request.params.id))
          .get();
        if (!current) throw notFound('That field');

        // The key deliberately does not follow the label: stored values, CSV
        // headers and API payloads all hang off it.
        const patch: Record<string, unknown> = {};
        if (request.body.label !== undefined) patch.label = request.body.label;
        if (request.body.sortOrder !== undefined) patch.sortOrder = request.body.sortOrder;
        if (Object.keys(patch).length === 0) return { customField: serialize(current) };

        tx.update(customFieldDefs).set(patch).where(eq(customFieldDefs.id, current.id)).run();
        writeAudit(
          tx,
          {
            type: 'system',
            action: 'custom_field.updated',
            actorMemberId: request.member!.id,
            actorName: request.member!.displayName,
            params: { key: current.key, label: request.body.label ?? current.label },
          },
          now,
        );

        return {
          customField: serialize(
            tx.select().from(customFieldDefs).where(eq(customFieldDefs.id, current.id)).get()!,
          ),
        };
      });
    },
  );

  typed.delete(
    '/api/v1/custom-fields/:id',
    { schema: { params: idParam }, preHandler: requireAction('custom_fields.manage') },
    async (request, reply) => {
      const now = deps.now();

      deps.db.transaction((tx) => {
        const current = tx
          .select()
          .from(customFieldDefs)
          .where(eq(customFieldDefs.id, request.params.id))
          .get();
        if (!current) throw notFound('That field');

        // Values cascade away with the definition — there is nowhere to keep
        // them once the column they described is gone.
        tx.delete(customFieldDefs).where(eq(customFieldDefs.id, current.id)).run();
        writeAudit(
          tx,
          {
            type: 'system',
            action: 'custom_field.deleted',
            actorMemberId: request.member!.id,
            actorName: request.member!.displayName,
            params: { key: current.key, label: current.label },
          },
          now,
        );
      });

      return reply.status(204).send();
    },
  );
}
