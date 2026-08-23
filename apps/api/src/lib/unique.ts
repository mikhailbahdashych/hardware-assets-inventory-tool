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
 * The other one: the asset somebody was assigning went to somebody else between
 * the check and the insert. It is not a form error — no field is wrong — so it
 * carries the same 409 code the pre-check in `services/assignments.ts` raises,
 * with the sentence that is true of a race rather than that one's "only an
 * asset that is Available or Ordered can be handed out", which by then is not.
 */
const lostTheAsset = () =>
  new AppError(
    409,
    'asset_unavailable',
    'That asset was handed out to somebody else a moment ago. Reload to see who has it.',
  );

/**
 * Constraint identifier → the answer that constraint has a name for. Two keys
 * per constraint, because the engines name the same one differently and neither
 * name is ours to choose.
 *
 * SQLite prints the **columns** after "UNIQUE constraint failed:" —
 * `assets.asset_tag`, and `a.b, a.c` for a composite one. Postgres reports the
 * **constraint or index name**, which drizzle-kit derived when it generated
 * `src/migrations-pg/`: `assets_asset_tag_unique` and friends, and for an index
 * the name the schema gave it. Both keys reach one answer, so a duplicate reads
 * identically whichever engine refused it.
 *
 * A constraint that is not in here is deliberately not translated: the
 * notification dedupe key, the role and status labels, the custom-field key —
 * invariants nobody typed at a form, where inventing a field name would hide a
 * real bug behind a 422. Adding one means knowing what a caller should read.
 */
const REGISTRY: Record<string, () => AppError> = {
  'assets.asset_tag': () => invalidFields(DUPLICATE_ASSET_TAG),
  'employees.email': () => invalidFields(DUPLICATE_EMPLOYEE_EMAIL),
  'members.email': () => invalidFields(DUPLICATE_MEMBER_EMAIL),
  'assignments.asset_id': lostTheAsset,
  assets_asset_tag_unique: () => invalidFields(DUPLICATE_ASSET_TAG),
  employees_email_unique: () => invalidFields(DUPLICATE_EMPLOYEE_EMAIL),
  members_email_unique: () => invalidFields(DUPLICATE_MEMBER_EMAIL),
  assignments_one_active_per_asset: lostTheAsset,
};

/** The libsql driver puts the columns in the message, and nowhere else. */
const SQLITE_UNIQUE = /UNIQUE constraint failed:\s*(.+)$/m;

/** Postgres's unique_violation. node-postgres carries it on the error object. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * What one link in the `cause` chain says this violation was about, or
 * undefined when it is not a uniqueness failure at all.
 */
function constraintOf(error: Error): string | undefined {
  // node-postgres hangs `code` and `constraint` off its error rather than
  // spelling either into the message, and neither is in Error's type.
  const { code, constraint } = error as Error & { code?: string; constraint?: string };
  if (code === PG_UNIQUE_VIOLATION && constraint !== undefined) return constraint;
  const match = SQLITE_UNIQUE.exec(error.message);
  // The regex matched, so its one capturing group did too.
  return match ? match[1]!.trim() : undefined;
}

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
    const constraint = constraintOf(current);
    const answer = constraint === undefined ? undefined : REGISTRY[constraint];
    if (answer) return answer();
  }
  return null;
}
