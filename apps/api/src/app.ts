import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppDeps, BuildAppOptions } from './types/app.js';
import { loggerOptions } from './lib/logging.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerOriginGuard } from './plugins/origin-guard.js';
import { registerSessionAuth } from './plugins/session.js';
import { registerStaticSpa } from './plugins/static-spa.js';
import { MAX_ATTACHMENT_BYTES } from './services/attachments.js';
import { makeStorage } from './services/storage.js';
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
import { registerNotificationRoutes } from './modules/notifications.js';
import { registerRoleRoutes } from './modules/roles.js';
import { registerSetupRoutes } from './modules/setup.js';
import { registerWorkflowRoutes } from './modules/workflow.js';

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const deps: AppDeps = {
    config: opts.config,
    db: opts.db,
    client: opts.client,
    // Not a fallback: `now` is an injection point tests reach for, and the
    // system clock is what the option means when nobody overrides it.
    now: opts.now ?? (() => new Date()),
    // Same shape again, and the config is what decides: a bucket if one is
    // named, the volume otherwise.
    storage: opts.storage ?? makeStorage(opts.config),
  };

  // Named, not inferred: since fastify 5.12.1 an inferred options object
  // matches the HTTP/2 factory overload first and the instance types as an
  // Http2SecureServer. The annotation keeps overload resolution on the plain
  // HTTP server this app actually runs.
  const options: FastifyServerOptions = {
    logger: loggerOptions(opts.config, opts.logDestination),
    // Decides what `request.ip` is, which is what the rate limits are keyed on.
    // Behind a reverse proxy without this, every request in the world shares
    // one bucket and ten bad logins lock everybody out for fifteen minutes.
    // With it set when nothing is in front, any client can claim any address
    // and the limits mean nothing — so it is opt-in, per deployment.
    trustProxy: opts.config.trustProxy,
  };
  const app = Fastify(options);

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
  registerWorkflowRoutes(app, deps);
  registerAttachmentRoutes(app, deps);
  registerRoleRoutes(app, deps);
  registerMemberRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerDataRoutes(app, deps);

  await registerStaticSpa(app, deps.config.webDist);

  return app;
}
