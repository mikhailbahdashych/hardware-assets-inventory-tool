import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schema from '@/db/schema.js';

/**
 * The database, as every service sees it. Typed against the libsql driver on
 * both engines: under Postgres `db/client.ts` casts a node-postgres instance to
 * this, which is sound because `db/schema.ts` pins the two schemas to identical
 * JS-facing shapes and drizzle's builders dispatch on the objects rather than
 * the types. That file's comment is the whole argument.
 */
export type Db = LibSQLDatabase<typeof schema>;

/** A live transaction inside `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Services that must run inside the caller's transaction accept either. */
export type DbOrTx = Db | Tx;

/**
 * What the app asks of the driver behind `db`: whether it is answering, and to
 * stop. Named rather than "the libsql client" because the two engines have
 * nothing else in common at that level and the app wants nothing else — a
 * health check and a shutdown. Every query goes through `db`.
 */
export interface DbClient {
  /** Round-trips one trivial statement. What `/healthz` is. */
  ping(): Promise<void>;
  /** Closes the connection or the pool. Called once, on the way out. */
  close(): Promise<void>;
}

/** A drizzle handle plus the driver behind it, from `createDb`. */
export interface DbHandle {
  db: Db;
  client: DbClient;
}
