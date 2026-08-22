import { AppError, invalidFields } from './errors.js';

/**
 * A unique index refusing a row, said the way a form can read it.
 *
 * The services still pre-check the three duplicates a person actually types —
 * an asset tag, an employee's email, a member's email — because a friendly
 * refusal before anything is written is the better experience and it names the
 * field without asking the database twice. What the pre-check is **not** any
 * more is the correctness story. It was, while better-sqlite3 made the whole
 * process one synchronous writer; under an async engine two transactions can
 * both read the same gap and only the second one find out. On SQLite the gap
 * is still closed — `BEGIN IMMEDIATE` holds the write lock across the check —
 * but Postgres has no such lock to lean on, and the index is what will catch
 * it there.
 *
 * So the index is the truth and the pre-check is the courtesy, and the two have
 * to answer identically. They do, by sharing these three objects rather than
 * repeating the sentence in two files.
 */
export const DUPLICATE_ASSET_TAG = { assetTag: 'That asset tag is already in use.' };
export const DUPLICATE_EMPLOYEE_EMAIL = {
  email: 'Another employee already uses that email address.',
};
export const DUPLICATE_MEMBER_EMAIL = {
  email: 'Someone already signs in with that email address.',
};

/**
 * Constraint identifier → the fields the form expects.
 *
 * The key is exactly what SQLite prints after "UNIQUE constraint failed:",
 * which is the column list rather than the index name (`assets.asset_tag`, and
 * `a.b, a.c` for a composite one). Phase 4 adds Postgres's `23505` and its
 * constraint names to this same map — the values are the part that must not be
 * written twice, and they are what a caller sees either way.
 *
 * A constraint that is not in here is deliberately not translated: the open
 * ownership index, the notification dedupe key and the rest are invariants
 * nobody typed, and inventing a field name for one would hide a real bug behind
 * a form error.
 */
const REGISTRY: Record<string, Record<string, string>> = {
  'assets.asset_tag': DUPLICATE_ASSET_TAG,
  'employees.email': DUPLICATE_EMPLOYEE_EMAIL,
  'members.email': DUPLICATE_MEMBER_EMAIL,
};

/** The driver puts the columns in the message, and nowhere else. */
const SQLITE_UNIQUE = /UNIQUE constraint failed:\s*(.+)$/m;

/**
 * The 422 this violation deserves, or null when it is not one this API has a
 * sentence for — in which case it stays whatever it was, and the error handler
 * answers 500, which is the honest reply to an invariant nobody explained.
 *
 * The whole `cause` chain is searched because drizzle does not rethrow what the
 * driver threw: it wraps it in a `Failed query: …` error and hangs the real one
 * off `cause`. Reading only the top message would find nothing, every time.
 */
export function translateUniqueViolation(error: unknown): AppError | null {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const match = SQLITE_UNIQUE.exec(current.message);
    // The regex matched, so its one capturing group did too.
    const fields = match ? REGISTRY[match[1]!.trim()] : undefined;
    if (fields) return invalidFields(fields);
  }
  return null;
}
