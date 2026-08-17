import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppDeps, BuildAppOptions } from './types/app.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerOriginGuard } from './plugins/origin-guard.js';
import { registerSessionAuth } from './plugins/session.js';
import { registerStaticSpa } from './plugins/static-spa.js';
import { MAX_ATTACHMENT_BYTES } from './services/attachments.js';
import { registerAssetRoutes } from './modules/assets.js';
import { registerAttachmentRoutes } from './modules/attachments.js';
import { registerAuthRoutes } from './modules/auth.js';
import { registerCustomFieldRoutes } from './modules/custom-fields.js';
import { registerEmployeeRoutes } from './modules/employees.js';
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
  };

  const app = Fastify({
    logger: opts.config.logLevel === 'silent' ? false : { level: opts.config.logLevel },
  });

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

  await registerStaticSpa(app, deps.config.webDist);

  return app;
}
