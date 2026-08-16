import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prefsPatchInput } from '@inventory/shared';
import type { AppDeps } from '../app.js';
import { members } from '../db/schema.js';
import { nowIso } from '../lib/dates.js';
import { serializeMember } from '../lib/serialize.js';
import { requireAuth } from '../plugins/rbac.js';

/** Personal preferences — every role may change their own. */
export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .patch(
      '/api/v1/me/prefs',
      { schema: { body: prefsPatchInput }, preHandler: requireAuth },
      async (request) => {
        const patch: Record<string, string> = {};
        if (request.body.theme) patch.theme = request.body.theme;
        if (request.body.density) patch.density = request.body.density;
        if (request.body.widgets) patch.widgetsJson = JSON.stringify(request.body.widgets);
        patch.updatedAt = nowIso(deps.now());

        deps.db.update(members).set(patch).where(eq(members.id, request.member!.id)).run();
        const updated = deps.db
          .select()
          .from(members)
          .where(eq(members.id, request.member!.id))
          .get()!;
        return { member: serializeMember(updated) };
      },
    );
}
