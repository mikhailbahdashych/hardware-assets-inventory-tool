import { migrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from '@/types/db.js';

/**
 * Applies checked-in migrations. Runs at every boot — pulling a newer image
 * and restarting IS the upgrade procedure. The caller resolves the folder
 * (src/migrations in dev/tests, dist/migrations in the built image) because
 * bundling changes file depths.
 */
export async function runMigrations(db: Db, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
