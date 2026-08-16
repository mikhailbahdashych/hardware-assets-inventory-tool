import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';

// Boot = migrate → seed → listen. Pulling a newer image and restarting IS the
// upgrade procedure; migrations are idempotent and applied on every start.
const config = loadConfig();

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, 'uploads'), { recursive: true });

const { db, sqlite } = createDb(join(config.dataDir, 'inventory.db'));
runMigrations(db, fileURLToPath(new URL('./migrations', import.meta.url)));
seed(db);

const app = await buildApp({ config, db, sqlite });
await app.listen({ port: config.port, host: config.host });
