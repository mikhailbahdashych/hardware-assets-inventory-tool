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

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, 'uploads'), { recursive: true });

const { db, sqlite } = createDb(join(config.dataDir, 'inventory.db'));
runMigrations(db, fileURLToPath(new URL('./migrations', import.meta.url)));
seed(db);

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
