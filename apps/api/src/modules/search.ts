import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '@/types/app.js';
import { requireAuth } from '@/plugins/rbac.js';
import { search } from '@/services/search.js';

const searchQuery = z.object({ q: z.string().default('') });

/**
 * ⌘K, server-side. Open to every authenticated member like the lists it draws
 * from — the cap and the narrow row shapes are what keep it from being a second
 * way to read the inventory.
 */
export function registerSearchRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/v1/search',
    { schema: { querystring: searchQuery }, preHandler: requireAuth },
    async (request) => search(deps.db, request.query.q),
  );
}
