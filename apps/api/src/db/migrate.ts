import { join } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { migrate as migrateSqlite } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Db } from '@/types/db.js';
import { ENGINE } from './engine.js';

/**
 * The migration folders per engine. `current` is what a schema change
 * generates into; `presquash` is the history v0.1.0 and v0.2.0 shipped, kept
 * only so that a database they wrote can be brought forward (see
 * `bridgePreSquash`). Nothing is ever generated into the second one.
 */
const FOLDERS = {
  sqlite: { current: 'migrations', presquash: 'migrations-presquash' },
  postgres: { current: 'migrations-pg', presquash: 'migrations-pg-presquash' },
} as const;

/** Where drizzle keeps its journal: the main schema on SQLite, `drizzle.` on pg. */
const JOURNAL = sql.raw(
  ENGINE === 'postgres' ? 'drizzle.__drizzle_migrations' : '__drizzle_migrations',
);

/**
 * A boot this version will not attempt, said as a sentence rather than a SQL
 * error. `index.ts` prints the message and stops.
 */
export class UpgradeRefused extends Error {}

/**
 * Applies checked-in migrations, and answers how many it applied. Runs at every
 * boot — pulling a newer image and restarting IS the upgrade procedure.
 *
 * The caller passes the directory the migration folders sit in (`src/` in dev
 * and tests, `dist/` in the built image) because bundling changes file depths;
 * which folder inside it, and which migrator reads it, is this function's
 * business. The dialects cannot share generated SQL, so they do not share a
 * folder, and a schema change means generating both.
 */
export async function runMigrations(db: Db, migrationsRoot: string): Promise<number> {
  const folders = FOLDERS[ENGINE];
  const before = await appliedHashes(db);
  if (before.length > 0) {
    await bridgePreSquash(db, migrationsRoot, before);
  }
  await applyFolder(db, join(migrationsRoot, folders.current));
  return (await appliedHashes(db)).length - before.length;
}

/**
 * The history was squashed into one `0000_init` per engine before v0.3.0, on
 * the premise that nothing was installed — but v0.1.0 and v0.2.0 are on GHCR.
 * Their databases carry the hashes of the migrations they actually ran, none of
 * which is the new `0000_init`'s, and drizzle decides what to apply by
 * timestamp: every old entry is older than `0000_init`, so it would replay the
 * whole baseline over tables that already exist and the boot would die.
 *
 * So a journal whose every hash is one of the pre-squash migrations is
 * finished off with the pre-squash folder itself — which leaves it at exactly
 * the schema `0000_init` was regenerated from — then checked for every table
 * `0000_init` creates, and `0000_init` recorded as applied the way drizzle
 * records one. The ordinary migrator then picks up at `0001`. A journal holding
 * anything else is not a database this version knows how to move, and it says
 * so before it touches a thing.
 */
async function bridgePreSquash(db: Db, root: string, applied: string[]): Promise<void> {
  const folders = FOLDERS[ENGINE];
  // The current folder always starts at `0000_init`; the journal is checked in.
  const init = readMigrationFiles({ migrationsFolder: join(root, folders.current) })[0]!;
  if (applied.includes(init.hash)) return;

  const legacyFolder = join(root, folders.presquash);
  const legacy = new Set(readMigrationFiles({ migrationsFolder: legacyFolder }).map((m) => m.hash));
  const unknown = applied.filter((hash) => !legacy.has(hash));
  if (unknown.length > 0) {
    throw new UpgradeRefused(
      `This database's migration history has ${unknown.length} ` +
        `${unknown.length === 1 ? 'entry' : 'entries'} this version does not recognise — ` +
        `it was written by a build that is neither a release this version upgrades from ` +
        `(v0.1.0, v0.2.0) nor this one. Nothing has been changed.\n` +
        `Start the version that wrote it, take the data out with Export all data ` +
        `on its Admin page, and bring this version up on an empty data directory or database.`,
    );
  }

  await applyFolder(db, legacyFolder);

  const expected = [...init.sql.join('\n').matchAll(/CREATE TABLE [`"]([^`"]+)[`"]/g)].map(
    (match) => match[1]!,
  );
  const present = new Set(await tableNames(db));
  const missing = expected.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new UpgradeRefused(
      `This database's migration history is a release this version upgrades from, but its ` +
        `tables do not match it: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} ` +
        `missing. Nothing more has been changed. Restore it from a backup of the version ` +
        `that wrote it, or start this version on an empty data directory or database.`,
    );
  }

  await run(
    db,
    sql`INSERT INTO ${JOURNAL} ("hash", "created_at") VALUES (${init.hash}, ${init.folderMillis})`,
  );
}

async function applyFolder(db: Db, migrationsFolder: string): Promise<void> {
  if (ENGINE === 'postgres') {
    // The mirror image of the cast in `db/schema.ts`: this handle really is a
    // node-postgres one, and only its type says otherwise.
    await migratePg(db as unknown as NodePgDatabase, { migrationsFolder });
    return;
  }
  await migrateSqlite(db, { migrationsFolder });
}

/** Every hash in drizzle's journal, or none when there is no journal yet. */
async function appliedHashes(db: Db): Promise<string[]> {
  const journalExists =
    ENGINE === 'postgres'
      ? sql`SELECT table_name AS v FROM information_schema.tables
            WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'`
      : sql`SELECT name AS v FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`;
  if ((await strings(db, journalExists)).length === 0) return [];
  return await strings(db, sql`SELECT hash AS v FROM ${JOURNAL}`);
}

async function tableNames(db: Db): Promise<string[]> {
  return await strings(
    db,
    ENGINE === 'postgres'
      ? sql`SELECT table_name AS v FROM information_schema.tables WHERE table_schema = current_schema()`
      : sql`SELECT name AS v FROM sqlite_master WHERE type = 'table'`,
  );
}

/** The `v` column of every row a query answers, on either engine. */
async function strings(db: Db, query: SQL): Promise<string[]> {
  const rows =
    ENGINE === 'postgres'
      ? (await (db as unknown as NodePgDatabase).execute(query)).rows
      : await db.all<Record<string, unknown>>(query);
  return rows.map((row) => String(row.v));
}

async function run(db: Db, statement: SQL): Promise<void> {
  if (ENGINE === 'postgres') await (db as unknown as NodePgDatabase).execute(statement);
  else await db.run(statement);
}
