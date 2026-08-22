import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import { orgSettings } from '@/db/schema.js';
import pkg from '../../package.json';

/** Public instance metadata: drives the web app's /setup redirect and the login footer. */
export function registerMetaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/meta', async () => {
    const [settings] = await deps.db.select().from(orgSettings);
    return {
      needsSetup: !settings,
      version: pkg.version,
      orgName: settings?.orgName,
      // Assets store a currency only when it differs from the organization's;
      // the UI needs this to render every other price.
      defaultCurrency: settings?.defaultCurrency,
      // Not a secret — it says this instance can send mail, nothing about
      // where. The UI needs it to stop offering checkboxes nothing acts on.
      smtpConfigured: deps.config.smtp !== null,
    };
  });

  app.get('/api/v1/healthz', async () => {
    await deps.client.execute('SELECT 1');
    return { ok: true };
  });
}
