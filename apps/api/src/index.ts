import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { createMailer } from './services/mailer.js';
import { startScheduler } from './services/scheduler.js';

// Boot = migrate → seed → listen. Pulling a newer image and restarting IS the
// upgrade procedure; migrations are idempotent and applied on every start.
const config = loadConfig();

// The one thing that can go wrong before anything is running: a data
// directory this process may not write to. The container entrypoint takes
// ownership of it, so reaching here means somebody ran with an explicit
// --user or mounted something read-only — and a sentence beats a stack trace.
try {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(join(config.dataDir, 'uploads'), { recursive: true });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `Inventory cannot write to its data directory (${config.dataDir}): ${reason}\n` +
      `It holds the database and the uploaded files, so there is nothing to do without it.\n` +
      `In Docker, make sure the mounted directory is writable by uid 1000, or let the\n` +
      `image start as root so its entrypoint can take ownership.\n`,
  );
  process.exit(1);
}

const { db, sqlite } = createDb(join(config.dataDir, 'inventory.db'));
runMigrations(db, fileURLToPath(new URL('./migrations', import.meta.url)));
seed(db);

// One omission, two protections off, and nothing else would say so: with the
// default APP_URL the session cookie is not Secure, and the origin guard has
// no configured origin to compare against. Both are correct for localhost and
// wrong for anything a browser reaches over TLS.
if (config.nodeEnv === 'production' && config.appUrl === 'http://localhost:3000') {
  process.stderr.write(
    `APP_URL is still http://localhost:3000 on a production instance.\n` +
      `Session cookies are not marked Secure and invitation links will point at localhost.\n` +
      `Set APP_URL to the address browsers actually reach this instance at.\n`,
  );
}

const mailer = createMailer(config);
const app = await buildApp({ config, db, sqlite, mailer });

// The same deps the app is using, for the jobs that run on a clock rather than
// on a request.
const scheduler = startScheduler({ config, db, sqlite, now: () => new Date(), mailer }, app.log);

// A container stop is a signal, and an unflushed SQLite handle is a corrupt
// backup waiting to happen.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    scheduler.stop();
    void app.close().then(() => {
      sqlite.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: config.port, host: config.host });
