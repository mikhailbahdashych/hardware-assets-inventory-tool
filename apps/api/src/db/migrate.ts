import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

/**
 * Applies checked-in migrations. Runs at every boot — pulling a newer image
 * and restarting IS the upgrade procedure. The caller resolves the folder
 * (src/migrations in dev/tests, dist/migrations in the built image) because
 * bundling changes file depths.
 */
export function runMigrations(db: Db, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}
