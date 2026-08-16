import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * In production the API serves the built SPA: static assets plus an
 * index.html fallback for any non-/api GET (client-side routing). Unknown
 * /api routes always get the JSON 404 envelope.
 */
export async function registerStaticSpa(app: FastifyInstance, webDist?: string): Promise<void> {
  const hasStatic = Boolean(webDist && existsSync(join(webDist, 'index.html')));
  if (hasStatic) {
    await app.register(fastifyStatic, { root: webDist! });
  }

  app.setNotFoundHandler((request, reply) => {
    if (hasStatic && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
  });
}
