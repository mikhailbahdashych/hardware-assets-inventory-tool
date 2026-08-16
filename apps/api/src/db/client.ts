import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;
/** A live transaction inside db.transaction(cb). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Services that must run inside the caller's transaction accept either. */
export type DbOrTx = Db | Tx;

export function createDb(path: string): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
