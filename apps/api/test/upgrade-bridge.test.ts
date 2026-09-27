import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate as migrateSqlite } from 'drizzle-orm/libsql/migrator';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { members } from '@/db/schema.js';
import { runMigrations } from '@/db/migrate.js';
import type { Db } from '@/types/db.js';
import { bareDatabase, MIGRATIONS_ROOT, type BareDatabase } from './helpers.js';

// v0.1.0 and v0.2.0 are published, and their databases carry the migration
// history from before it was squashed into one `0000_init` per engine. Booting
// this version over one used to replay `0000_init` over tables that were
// already there and die. The bridge recognises that history, brings it to the
// last pre-squash schema, records `0000_init` as applied, and lets the
// ordinary migrator carry on from `0001`.

const PG = Boolean(process.env.DATABASE_URL);

/** How many pre-squash migrations v0.2.0 shipped: SQLite 0000–0004, Postgres 0000. */
const V020_ENTRIES = PG ? 1 : 5;

let bare: BareDatabase | undefined;
let scratch: string | undefined;
afterEach(async () => {
  await bare?.dispose();
  bare = undefined;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

/** The pre-squash folder cut down to what one release shipped. */
function presquashAsOf(entries: number): string {
  return folderAsOf(PG ? 'migrations-pg-presquash' : 'migrations-presquash', entries);
}

/** A migration folder cut down to its first `entries` migrations. */
function folderAsOf(folder: string, entries: number): string {
  scratch = mkdtempSync(join(tmpdir(), 'inventory-presquash-'));
  const source = join(MIGRATIONS_ROOT, folder);
  cpSync(source, scratch, { recursive: true });
  const journalPath = join(scratch, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, entries);
  writeFileSync(journalPath, JSON.stringify(journal));
  return scratch;
}

async function applyFolder(db: Db, folder: string): Promise<void> {
  if (PG) await migratePg(db as unknown as NodePgDatabase, { migrationsFolder: folder });
  else await migrateSqlite(db, { migrationsFolder: folder });
}

async function query(
  db: Db,
  statement: ReturnType<typeof sql>,
): Promise<Record<string, unknown>[]> {
  if (PG) return (await (db as unknown as NodePgDatabase).execute(statement)).rows;
  return await db.all<Record<string, unknown>>(statement);
}

const journal = PG ? sql.raw('drizzle.__drizzle_migrations') : sql.raw('__drizzle_migrations');

describe('booting over a v0.2.0 database', () => {
  it('bridges the pre-squash journal and keeps every row', async () => {
    bare = await bareDatabase();
    await applyFolder(bare.db, presquashAsOf(V020_ENTRIES));
    await query(
      bare.db,
      sql`INSERT INTO employees (id, first_name, last_name, email, status, created_at, updated_at)
          VALUES ('emp-1', 'Maya', 'Lindqvist', 'maya@acme.io', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    await runMigrations(bare.db, MIGRATIONS_ROOT);

    const people = await query(bare.db, sql`SELECT first_name FROM employees`);
    expect(people).toEqual([{ first_name: 'Maya' }]);
    // Selecting through the current schema names every column it has, so this
    // fails if anything after v0.2.0 — 0001_mfa_last_step included — is missing.
    expect(await bare.db.select().from(members)).toEqual([]);
    const current = readFileSync(
      join(MIGRATIONS_ROOT, PG ? 'migrations-pg' : 'migrations', 'meta', '_journal.json'),
      'utf8',
    );
    const newest = (JSON.parse(current) as { entries: { when: number }[] }).entries.at(-1)!.when;
    const [last] = await query(
      bare.db,
      sql`SELECT created_at FROM ${journal} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(Number(last!.created_at)).toBe(newest);
  });

  it('is a no-op the second time', async () => {
    bare = await bareDatabase();
    await applyFolder(bare.db, presquashAsOf(V020_ENTRIES));
    await runMigrations(bare.db, MIGRATIONS_ROOT);
    const before = await query(bare.db, sql`SELECT hash FROM ${journal}`);

    expect(await runMigrations(bare.db, MIGRATIONS_ROOT)).toBe(0);
    expect(await query(bare.db, sql`SELECT hash FROM ${journal}`)).toEqual(before);
  });

  it('bridges a checkout from after v0.2.0 but before the squash too', async () => {
    bare = await bareDatabase();
    await applyFolder(bare.db, presquashAsOf(Number.MAX_SAFE_INTEGER));
    await runMigrations(bare.db, MIGRATIONS_ROOT);
    expect(await bare.db.select().from(members)).toEqual([]);
  });

  it('refuses a history it does not recognise, with a sentence and nothing changed', async () => {
    bare = await bareDatabase();
    await applyFolder(bare.db, presquashAsOf(V020_ENTRIES));
    await query(
      bare.db,
      sql`INSERT INTO ${journal} ("hash", "created_at") VALUES ('not-a-release', 1788000000000)`,
    );
    const before = await query(bare.db, sql`SELECT hash FROM ${journal}`);

    await expect(runMigrations(bare.db, MIGRATIONS_ROOT)).rejects.toThrow(
      /does not recognise[\s\S]*Nothing has been changed/,
    );
    expect(await query(bare.db, sql`SELECT hash FROM ${journal}`)).toEqual(before);
  });
});

describe('booting a fresh database', () => {
  it('applies every migration and says how many', async () => {
    bare = await bareDatabase();
    const applied = await runMigrations(bare.db, MIGRATIONS_ROOT);
    const rows = await query(bare.db, sql`SELECT hash FROM ${journal}`);
    expect(applied).toBe(rows.length);
    expect(applied).toBeGreaterThan(1);
    expect(await runMigrations(bare.db, MIGRATIONS_ROOT)).toBe(0);
  });
});

describe('0002 on a workspace that already has two members on one employee', () => {
  it('keeps the earliest link and unlinks the rest, rather than failing every boot', async () => {
    bare = await bareDatabase();
    await applyFolder(bare.db, folderAsOf(PG ? 'migrations-pg' : 'migrations', 2));
    const at = (day: string) => `2026-01-0${day}T00:00:00.000Z`;
    await query(
      bare.db,
      sql`INSERT INTO employees (id, first_name, last_name, email, status, created_at, updated_at)
          VALUES ('emp-1', 'Grace', 'Chen', 'grace@acme.io', 'active', ${at('1')}, ${at('1')})`,
    );
    for (const [id, email, day] of [
      ['m-late', 'g.chen@acme.io', '3'],
      ['m-first', 'grace.chen@acme.io', '2'],
    ] as const) {
      await query(
        bare.db,
        sql`INSERT INTO members (id, email, display_name, role, status, employee_id, created_at, updated_at)
            VALUES (${id}, ${email}, 'Grace Chen', 'viewer', 'invited', 'emp-1', ${at(day)}, ${at(day)})`,
      );
    }

    await runMigrations(bare.db, MIGRATIONS_ROOT);

    const links = await query(bare.db, sql`SELECT id, employee_id FROM members ORDER BY id`);
    expect(links).toEqual([
      { id: 'm-first', employee_id: 'emp-1' },
      { id: 'm-late', employee_id: null },
    ]);
  });
});
