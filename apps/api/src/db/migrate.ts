import { join } from 'node:path';
import { migrate as migrateSqlite } from 'drizzle-orm/libsql/migrator';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Db } from '@/types/db.js';
import { ENGINE } from './engine.js';

/**
 * Applies checked-in migrations. Runs at every boot — pulling a newer image
 * and restarting IS the upgrade procedure.
 *
 * The caller passes the directory the migration folders sit in (`src/` in dev
 * and tests, `dist/` in the built image) because bundling changes file depths;
 * which of the two folders inside it, and which migrator reads it, is this
 * function's business. The dialects cannot share generated SQL, so they do not
 * share a folder: `migrations/` is SQLite's and `migrations-pg/` is Postgres's,
 * and a schema change means generating both.
 */
export async function runMigrations(db: Db, migrationsRoot: string): Promise<void> {
  if (ENGINE === 'postgres') {
    // The mirror image of the cast in `db/schema.ts`: this handle really is a
    // node-postgres one, and only its type says otherwise.
    await migratePg(db as unknown as NodePgDatabase, {
      migrationsFolder: join(migrationsRoot, 'migrations-pg'),
    });
    return;
  }
  await migrateSqlite(db, { migrationsFolder: join(migrationsRoot, 'migrations') });
}
