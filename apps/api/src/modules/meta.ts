import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import { orgSettings } from '@/db/schema.js';
import pkg from '../../package.json';

/** Public instance metadata: drives the web app's /setup redirect and the login footer. */
export function registerMetaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/meta', async () => {
    const settings = deps.db.select().from(orgSettings).get();
    return {
      needsSetup: !settings,
      version: pkg.version,
      orgName: settings?.orgName,
      // Assets store a currency only when it differs from the organization's;
      // the UI needs this to render every other price.
      defaultCurrency: settings?.defaultCurrency,
    };
  });

  app.get('/api/v1/healthz', async () => {
    deps.sqlite.prepare('SELECT 1').get();
    return { ok: true };
  });
}
