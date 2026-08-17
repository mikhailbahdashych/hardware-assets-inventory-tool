import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppDeps, BuildAppOptions } from './types/app.js';
import { loggerOptions } from './lib/logging.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerOriginGuard } from './plugins/origin-guard.js';
import { registerSessionAuth } from './plugins/session.js';
import { registerStaticSpa } from './plugins/static-spa.js';
import { MAX_ATTACHMENT_BYTES } from './services/attachments.js';
import { createMailer } from './services/mailer.js';
import { registerAdminRoutes } from './modules/admin.js';
import { registerAssetRoutes } from './modules/assets.js';
import { registerAttachmentRoutes } from './modules/attachments.js';
import { registerAuthRoutes } from './modules/auth.js';
import { registerCustomFieldRoutes } from './modules/custom-fields.js';
import { registerDataRoutes } from './modules/data.js';
import { registerEmployeeRoutes } from './modules/employees.js';
import { registerMemberRoutes } from './modules/members.js';
import { registerMeRoutes } from './modules/me.js';
import { registerMetaRoutes } from './modules/meta.js';
import { registerSetupRoutes } from './modules/setup.js';

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const deps: AppDeps = {
    config: opts.config,
    db: opts.db,
    sqlite: opts.sqlite,
    // Not a fallback: `now` is an injection point tests reach for, and the
    // system clock is what the option means when nobody overrides it.
    now: opts.now ?? (() => new Date()),
    // Same shape: an omitted mailer means "build one from the config", which
    // is itself null when no SMTP host is set.
    mailer: opts.mailer !== undefined ? opts.mailer : createMailer(opts.config),
  };

  const app = Fastify({ logger: loggerOptions(opts.config, opts.logDestination) });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await app.register(fastifyCookie);
  registerOriginGuard(app, deps.config); // before session/rate-limit: cheapest rejection first
  registerSessionAuth(app, deps);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });

  registerMetaRoutes(app, deps);
  registerSetupRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerAssetRoutes(app, deps);
  registerEmployeeRoutes(app, deps);
  registerCustomFieldRoutes(app, deps);
  registerAttachmentRoutes(app, deps);
  registerMemberRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerDataRoutes(app, deps);

  await registerStaticSpa(app, deps.config.webDist);

  return app;
}
