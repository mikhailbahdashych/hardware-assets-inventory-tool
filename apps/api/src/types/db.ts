import type { Client } from '@libsql/client';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schema from '@/db/schema.js';

export type Db = LibSQLDatabase<typeof schema>;

/** A live transaction inside `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Services that must run inside the caller's transaction accept either. */
export type DbOrTx = Db | Tx;

/**
 * A drizzle handle plus the libsql client behind it. The client is what a
 * health check pings and what a shutdown closes; everything else goes through
 * `db`.
 */
export interface DbHandle {
  db: Db;
  client: Client;
}
