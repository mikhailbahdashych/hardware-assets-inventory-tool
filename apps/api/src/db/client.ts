import { join, resolve } from 'node:path';
import {
  createClient,
  type Client,
  type InArgs,
  type InStatement,
  type TransactionMode,
} from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '@/types/config.js';
import type { Db, DbHandle } from '@/types/db.js';
import * as schema from './schema.js';

// `pg` is CommonJS with no named exports through Node's ESM interop, so the
// class comes off the default export rather than out of the import list.
const { Pool } = pg;

/**
 * How long a statement waits for a **different process** to let go of the write
 * lock — the `PRAGMA busy_timeout` this file used to set, moved onto the client
 * because libsql opens connections on demand and a per-connection pragma would
 * only ever have been true of the first one. Inside this process nothing ever
 * waits on the lock: `WriteGate` below is why.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * One SQLite file has exactly one writer, and `@libsql/client` opens a **fresh
 * connection for every transaction** — it hands the current one to the
 * transaction and lazily makes another for whatever comes next. So two
 * overlapping transactions are two connections racing for the same write lock:
 * the loser blocks (libsql's local driver is synchronous under its promises,
 * so it blocks the event loop) until the busy timeout, then fails.
 *
 * better-sqlite3 gave us the answer for free by being synchronous. This is that
 * guarantee written down: every statement waits for the one in front, and a
 * transaction holds the gate from `BEGIN` to `COMMIT`. It costs nothing real —
 * the driver executes synchronously either way — and it is what keeps the async
 * port a change of shape rather than a change of behaviour.
 *
 * The one rule it imposes: **nothing inside a transaction callback may touch
 * the outer handle**, or it would queue behind the transaction it is part of.
 * Everything inside takes `tx`, which is the rule the audit-in-the-same-
 * transaction convention already enforces everywhere.
 *
 * `test/concurrency.test.ts` is what fails if this goes. Nothing else does:
 * driven through `app.inject` the requests happen to take the write lock one
 * at a time, and it is the scheduler and the CLIs that have nothing arranging
 * that for them.
 */
class WriteGate {
  /** Resolves when the operation currently holding the gate has released it. */
  #tail: Promise<void> = Promise.resolve();

  /** Waits for the gate and returns the function that opens it again. */
  async enter(): Promise<() => void> {
    let open!: () => void;
    const mine = new Promise<void>((resolveMine) => {
      open = resolveMine;
    });
    const ahead = this.#tail;
    this.#tail = ahead.then(() => mine);
    await ahead;
    // Idempotent: a transaction is released by whichever of commit, rollback
    // or close gets there first, and the others must be harmless.
    return open;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const open = await this.enter();
    try {
      return await work();
    } finally {
      open();
    }
  }
}

/**
 * The client every query goes through, with the gate around it. Written out
 * method by method rather than proxied so that what is serialized is something
 * you can read rather than infer.
 */
function serialize(client: Client, gate: WriteGate): Client {
  return {
    execute: (stmt: InStatement | string, args?: InArgs) =>
      gate.run(() => client.execute(stmt as string, args)),
    batch: (stmts, mode) => gate.run(() => client.batch(stmts, mode)),
    migrate: (stmts) => gate.run(() => client.migrate(stmts)),
    executeMultiple: (sql) => gate.run(() => client.executeMultiple(sql)),
    transaction: async (mode?: TransactionMode) => {
      const open = await gate.enter();
      let tx;
      try {
        tx = await client.transaction(mode);
      } catch (error) {
        open();
        throw error;
      }
      return {
        execute: (stmt: InStatement) => tx.execute(stmt),
        batch: (stmts) => tx.batch(stmts),
        executeMultiple: (sql) => tx.executeMultiple(sql),
        commit: async () => {
          try {
            await tx.commit();
          } finally {
            open();
          }
        },
        rollback: async () => {
          try {
            await tx.rollback();
          } finally {
            open();
          }
        },
        close: () => {
          try {
            tx.close();
          } finally {
            open();
          }
        },
        get closed() {
          return tx.closed;
        },
      };
    },
    sync: () => client.sync(),
    reconnect: () => client.reconnect(),
    close: () => client.close(),
    get closed() {
      return client.closed;
    },
    get protocol() {
      return client.protocol;
    },
  };
}

/**
 * The database this configuration names: the SQLite file under `DATA_DIR`, or
 * the Postgres server `DATABASE_URL` points at. The two branches below are the
 * only place in the codebase that knows there is a choice — everything else is
 * handed a `Db` and queries the tables `db/schema.ts` selected.
 */
export async function createDb(config: Config): Promise<DbHandle> {
  return config.databaseUrl === undefined
    ? await createSqliteDb(join(config.dataDir, 'inventory.db'))
    : createPostgresDb(config.databaseUrl);
}

/**
 * The database handle for one SQLite file. `path` is a filesystem path — the
 * `file:` URL libsql wants is this function's business, and an absolute one
 * because a relative URL would be resolved against whatever the process
 * happened to be started in.
 *
 * Of the four pragmas this used to set, one still belongs here. `journal_mode`
 * is written into the file header, so setting WAL once is setting it forever.
 * `foreign_keys` is on by default on every connection libsql opens (proved by
 * the cascade in `test/members.test.ts` — a session row outliving its member
 * would fail there). `busy_timeout` is per-connection and would not survive the
 * connection churn, so it moved onto the client, which applies it to every
 * connection it opens. `synchronous` has nowhere to go: it is per-connection
 * with no client-level equivalent, so this instance runs at SQLite's default
 * FULL rather than the NORMAL it used to ask for — stricter about durability
 * than before, which is the safe direction to lose a tuning knob in.
 */
async function createSqliteDb(path: string): Promise<DbHandle> {
  const client = serialize(
    createClient({ url: `file:${resolve(path)}`, timeout: BUSY_TIMEOUT_MS }),
    new WriteGate(),
  );
  await client.execute('PRAGMA journal_mode = WAL');
  return {
    db: drizzle(client, { schema }),
    client: {
      ping: async () => {
        await client.execute('SELECT 1');
      },
      close: async () => {
        client.close();
      },
    },
  };
}

/**
 * The handle for a Postgres server. A pool rather than a connection, because
 * that is what a server with a connection limit expects and what lets two
 * transactions actually overlap.
 *
 * **No `WriteGate` here, deliberately.** The gate upstairs exists because one
 * SQLite file has one writer and libsql opens a fresh connection per
 * transaction, so two overlapping transactions are two connections racing for
 * the same lock. Postgres has a real lock manager and MVCC: concurrent writers
 * are the normal case, a conflict waits on the row rather than the database,
 * and serializing every statement in the process would throw away the engine's
 * whole point. What the gate was quietly also doing — closing the gap between a
 * uniqueness pre-check and its insert — is done here by the unique index and
 * `lib/unique.ts`, which is why that translation exists.
 *
 * The cast is the one `db/schema.ts` describes: these tables really are
 * `pgTable`s and this really is node-postgres, and the parity test is what says
 * the SQLite-shaped types over them are honest.
 */
function createPostgresDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString });
  return {
    db: drizzlePg(pool, { schema }) as unknown as Db,
    client: {
      ping: async () => {
        await pool.query('SELECT 1');
      },
      close: async () => {
        await pool.end();
      },
    },
  };
}
