import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/app.js';
import { customFieldDefs } from '@/db/schema.js';
import { requireAuth } from '@/plugins/rbac.js';

/**
 * The custom-field definitions asset forms render. Managing the definitions
 * themselves (the "Manage fields" modal) arrives with the assignment PR; the
 * boot seed creates the four the design shows.
 */
export function registerCustomFieldRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/custom-fields', { preHandler: requireAuth }, async () => ({
    customFields: deps.db
      .select()
      .from(customFieldDefs)
      .orderBy(customFieldDefs.sortOrder)
      .all()
      .map((def) => ({ key: def.key, label: def.label, type: def.type })),
  }));
}
