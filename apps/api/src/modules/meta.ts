import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import { orgSettings } from '@/db/schema.js';
import pkg from '../../package.json';

/** Public instance metadata: drives the web app's /setup redirect and the login footer. */
export function registerMetaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/meta', async () => {
    const [settings] = await deps.db.select().from(orgSettings);
    // Before /setup there is no organization to name, and `needsSetup` is how
    // this says so — the two keys are absent rather than invented.
    if (!settings) return { needsSetup: true, version: pkg.version };
    return {
      needsSetup: false,
      version: pkg.version,
      orgName: settings.orgName,
      // Every asset created since stores its own currency; this is the
      // fallback for rows from before that, which stored NULL.
      defaultCurrency: settings.defaultCurrency,
    };
  });

  app.get('/api/v1/healthz', async () => {
    await deps.client.ping();
    return { ok: true };
  });
}
