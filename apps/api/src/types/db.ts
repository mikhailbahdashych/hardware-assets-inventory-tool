import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '@/db/schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/** A live transaction inside `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Services that must run inside the caller's transaction accept either. */
export type DbOrTx = Db | Tx;

/** A drizzle handle plus the raw better-sqlite3 connection behind it. */
export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
}
