import { is, type SQL } from 'drizzle-orm';
import { PgTable, getTableConfig as pgTableConfig } from 'drizzle-orm/pg-core';
import { SQLiteTable, getTableConfig as sqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as pgSchema from '@/db/schema.pg.js';
import * as sqliteSchema from '@/db/schema.sqlite.js';

/**
 * The two dialect modules are one logical schema written twice, and this is
 * what keeps them one. It is also the proof behind the cast in `db/schema.ts`:
 * that file hands services the Postgres tables typed as the SQLite ones, which
 * is only sound while every JS-facing fact below is identical on both sides —
 * the same tables, the same columns, the same nullability, the same defaults
 * and the same names on every index and constraint.
 *
 * Add a table or a column to one dialect and this fails naming the other.
 */

/** Whatever a column is called and whatever it means to JavaScript. */
interface ComparableColumn {
  name: string;
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
  primary: boolean;
  isUnique: boolean;
  uniqueName: string | undefined;
}

/** An index, by the only two things a dialect cannot rename away. */
interface ComparableIndex {
  config: { name?: string | undefined; unique: boolean; where?: SQL | undefined };
}

/** Unique constraints and primary keys both answer `getName()`. */
interface ComparableConstraint {
  getName(): string | undefined;
  columns: { name: string }[];
}

function columnFacts(columns: ComparableColumn[]): string[] {
  return columns
    .map(
      (column) =>
        `${column.name}: ${column.dataType}` +
        `${column.notNull ? ' notNull' : ''}` +
        `${column.hasDefault ? ' default' : ''}` +
        `${column.primary ? ' pk' : ''}` +
        `${column.isUnique ? ` unique(${column.uniqueName})` : ''}`,
    )
    .sort();
}

function indexFacts(indexes: ComparableIndex[]): string[] {
  return indexes
    .map(
      (entry) =>
        `${entry.config.name}${entry.config.unique ? ' unique' : ''}` +
        `${entry.config.where ? ' partial' : ''}`,
    )
    .sort();
}

function constraintFacts(constraints: ComparableConstraint[]): string[] {
  return constraints
    .map((entry) => `${entry.getName()} on (${entry.columns.map((c) => c.name).join(', ')})`)
    .sort();
}

/**
 * The exported tables of one dialect module, keyed by the name services import
 * them under — `schema.ts` re-exports one set or the other under exactly these
 * names, so it is the export name and not the SQL name that has to line up.
 */
function tablesOf<T>(module: Record<string, unknown>, isTable: (value: unknown) => value is T) {
  return new Map(Object.entries(module).filter((entry): entry is [string, T] => isTable(entry[1])));
}

const sqliteTables = tablesOf(sqliteSchema, (value): value is SQLiteTable =>
  is(value, SQLiteTable),
);
const pgTables = tablesOf(pgSchema, (value): value is PgTable => is(value, PgTable));

describe('the sqlite and postgres schemas are one schema', () => {
  it('exports the same tables under the same names', () => {
    expect([...pgTables.keys()].sort()).toEqual([...sqliteTables.keys()].sort());
  });

  it.each([...sqliteTables.keys()].sort())('%s matches in both dialects', (exportName) => {
    const sqliteTable = sqliteTables.get(exportName);
    const pgTable = pgTables.get(exportName);
    // Both are present: the test above says so, and it.each is driven by the
    // sqlite side.
    const sqlite = sqliteTableConfig(sqliteTable!);
    const pg = pgTableConfig(pgTable!);

    expect(pg.name).toBe(sqlite.name);
    expect(columnFacts(pg.columns)).toEqual(columnFacts(sqlite.columns));
    expect(indexFacts(pg.indexes)).toEqual(indexFacts(sqlite.indexes));
    expect(constraintFacts(pg.uniqueConstraints)).toEqual(
      constraintFacts(sqlite.uniqueConstraints),
    );
    expect(constraintFacts(pg.primaryKeys)).toEqual(constraintFacts(sqlite.primaryKeys));
  });
});
