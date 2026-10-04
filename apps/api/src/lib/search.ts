import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';

// Searching a list, in the one way that means the same thing on both engines.
//
// SQLite's LIKE folds ASCII case by itself; PostgreSQL's does not. A query
// written for one would silently find nothing on the other, so both sides are
// lowered here rather than trusting the operator — see "Two engines, one
// boundary" in apps/api/CLAUDE.md.
//
// Both sides are lowered **by the database**, not one in JS and one in SQL.
// SQLite's `lower()` folds ASCII only, so a needle lowered in JS ("łukasz")
// never met a column lowered in SQLite ("Łukasz") — text typed exactly as
// stored found nothing. Lowered by the same function, exact case always
// matches on both engines. What remains is a SQLite limit, not a bug here:
// "łukasz" does not find "Łukasz" there, because SQLite has no Unicode case
// folding without the ICU extension; PostgreSQL folds it.

/** What a whole-list endpoint answers with, and the most it will ever answer. */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

/**
 * The querystring all three whole-list endpoints take, mirroring the inbox's.
 * It lives beside the bounds it enforces so the number and the refusal cannot
 * drift apart.
 */
export const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * The asset list's own two filters on top of the page: `status` is the pill
 * row, `assignable` is the assign modal asking for only what it may offer.
 *
 * It sits beside `listQuery` rather than inside `modules/assets.ts` because the
 * internal route and its public twin must take the identical querystring — one
 * schema, so the two lists cannot answer differently to the same request.
 */
export const assetListQuery = listQuery.extend({
  status: z.string().optional(),
  // Spelled out rather than coerced: `z.coerce.boolean()` reads the string
  // "false" as true, which is the wrong answer to a query somebody wrote.
  assignable: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/** The escape character named by the ESCAPE clause in `contains` below. */
const ESCAPE = '\\';

/**
 * `%` and `_` are LIKE's own wildcards, so a person searching for "100%" must
 * not be handed the whole inventory. The escape character is escaped first,
 * because otherwise it would escape whatever the replacement put after it.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `${ESCAPE}${character}`);
}

/**
 * One column contains this text, whatever the case and whatever the engine.
 * The ESCAPE clause is written out rather than bound: Postgres cannot infer a
 * type for a parameter in that position, and it is a constant of this module.
 */
export function contains(column: SQLWrapper, query: string): SQL {
  // The cast names the parameter's type, so Postgres never has to choose
  // between `lower(text)` and its range-bound `lower(anyrange)` for it.
  return sql`lower(${column}) LIKE lower(cast(${`%${escapeLike(query)}%`} as text)) ESCAPE '\\'`;
}

/**
 * Any of these columns contains it — the ORed match the browser used to do
 * over the whole list. Parenthesised, because this goes inside an `and()` with
 * the status filter and OR binds looser than AND. Undefined for an absent or
 * blank query — `ListQuery.q` is absent when nothing was typed — which is
 * drizzle's own "no condition" and so reads as "everything".
 */
export function containsAny(query: string | undefined, columns: SQLWrapper[]): SQL | undefined {
  if (query === undefined) return undefined;
  const needle = query.trim();
  if (needle === '') return undefined;
  return sql`(${sql.join(
    columns.map((column) => contains(column, needle)),
    sql` OR `,
  )})`;
}
