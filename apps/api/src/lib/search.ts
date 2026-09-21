import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';

// Searching a list, in the one way that means the same thing on both engines.
//
// SQLite's LIKE folds ASCII case by itself; PostgreSQL's does not. A query
// written for one would silently find nothing on the other, so both sides are
// lowered here rather than trusting the operator — see "Two engines, one
// boundary" in apps/api/CLAUDE.md.

/** What a whole-list endpoint answers with, and the most it will ever answer. */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

/**
 * The querystring all three whole-list endpoints take, mirroring the inbox's.
 * It lives beside the bounds it enforces so the number and the refusal cannot
 * drift apart; the assets route extends it with its own two filters.
 */
export const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
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
  return sql`lower(${column}) LIKE ${`%${escapeLike(query.toLowerCase())}%`} ESCAPE '\\'`;
}

/**
 * Any of these columns contains it — the ORed match the browser used to do
 * over the whole list. Parenthesised, because this goes inside an `and()` with
 * the status filter and OR binds looser than AND. Undefined for a blank query,
 * which is drizzle's own "no condition" and so reads as "everything".
 */
export function containsAny(query: string, columns: SQLWrapper[]): SQL | undefined {
  const needle = query.trim();
  if (needle === '') return undefined;
  return sql`(${sql.join(
    columns.map((column) => contains(column, needle)),
    sql` OR `,
  )})`;
}
