import { randomInt } from 'node:crypto';
import { and, count, eq, isNull, lt, or } from 'drizzle-orm';
import { RECOVERY_CODE_COUNT } from '@inventory/shared';
import type { Db, DbOrTx } from '@/types/db.js';
import type { MfaEnrolment, MfaStatus } from '@/types/mfa.js';
import type { MemberRow } from '@/types/members.js';
import { members, mfaRecoveryCodes, sessions } from '@/db/schema.js';
import { AppError, notFound } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';
import { hashToken } from '@/lib/tokens.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '@/lib/totp.js';

/**
 * Two-factor authentication, TOTP only.
 *
 * The shape of it: the workspace either demands a second factor of everybody or
 * of nobody — `org_settings.mfa_required` — and a member either has a confirmed
 * authenticator or does not. Those two facts produce the only three states that
 * matter, which {@link mfaStatus} names.
 *
 * A secret is written at the start of enrolment and confirmed only once a live
 * code proves the authenticator really has it. Until then the member is not
 * enrolled, so an abandoned enrolment leaves nothing to be locked out by.
 */

/** Ambiguity-free alphabet: no l/1, no o/0 — these get read off a screen. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function mfaStatus(required: boolean, member: Pick<MemberRow, 'mfaConfirmedAt'>): MfaStatus {
  const enrolled = member.mfaConfirmedAt !== null;
  return { required, enrolled, mustEnrol: required && !enrolled };
}

/**
 * Starts enrolment: a secret stored unconfirmed, minted once. Asking again
 * before confirming answers the same secret — see the note in the body.
 */
export async function beginEnrolment(
  db: DbOrTx,
  member: MemberRow,
  orgName: string,
  now: Date,
): Promise<MfaEnrolment> {
  if (member.mfaConfirmedAt) {
    throw new AppError(
      409,
      'mfa_already_enrolled',
      'This account already has an authenticator. An admin has to reset it before a new one can be added.',
    );
  }

  // A secret already minted and not yet confirmed is handed back as it is.
  // The enrolment screen asks on every mount, and a reload after scanning the
  // QR code used to replace the secret the authenticator had just saved — so
  // the code it then showed could never confirm anything. Admin resets and
  // turning the requirement off both clear the column, which is what starts a
  // genuinely new enrolment.
  if (member.mfaSecret) {
    return {
      secret: member.mfaSecret,
      otpauthUri: otpauthUri(member.mfaSecret, member.email, orgName),
    };
  }

  const secret = generateTotpSecret();
  await db
    .update(members)
    .set({ mfaSecret: secret, updatedAt: nowIso(now) })
    .where(eq(members.id, member.id));

  return { secret, otpauthUri: otpauthUri(secret, member.email, orgName) };
}

/**
 * Finishes enrolment against a live code, and issues the recovery codes in the
 * same transaction — a confirmed authenticator with no way around it is how
 * somebody ends up locked out of their own workspace.
 *
 * Returns the raw codes. They are stored hashed and never recoverable, which is
 * why the UI shows them once and says so.
 */
export async function confirmEnrolment(
  db: Db,
  member: MemberRow,
  code: string,
  now: Date,
): Promise<string[]> {
  if (member.mfaConfirmedAt) {
    throw new AppError(409, 'mfa_already_enrolled', 'This account already has an authenticator.');
  }
  if (!member.mfaSecret) {
    throw new AppError(409, 'mfa_not_started', 'Start setting up two-factor authentication first.');
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await db.transaction(async (tx) => {
    // Accepted here counts as used: the code that proved the authenticator
    // does not also get to sign in with it a few seconds later.
    if (!(await acceptTotp(tx, member, code, now))) {
      throw new AppError(422, 'mfa_code_invalid', 'That code is not right — try the current one.');
    }
    await tx
      .update(members)
      .set({ mfaConfirmedAt: nowIso(now), updatedAt: nowIso(now) })
      .where(eq(members.id, member.id));
    await replaceRecoveryCodes(tx, member.id, codes, now);
  });
  return codes;
}

/**
 * Whether a code gets somebody in — an authenticator code or one of their
 * recovery codes, decided by what matches rather than by what they claim.
 * A recovery code is spent here, in the same call that accepts it.
 */
export async function verifyChallenge(
  db: DbOrTx,
  member: MemberRow,
  code: string,
  now: Date,
): Promise<boolean> {
  const candidate = code.trim().toLowerCase();
  if (await acceptTotp(db, member, code, now)) return true;

  // Finding the code and spending it are one conditional UPDATE, for the
  // reason `acceptTotp` gives: a lookup and then a write lets two requests
  // racing one code both find it unused and both spend it. Nothing returned is
  // a code that is wrong or already spent — the same answer either way.
  const spent = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: nowIso(now) })
    .where(
      and(
        eq(mfaRecoveryCodes.memberId, member.id),
        eq(mfaRecoveryCodes.codeHash, hashToken(candidate)),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id });
  return spent.length > 0;
}

/**
 * An authenticator code, accepted at most once — RFC 6238 §5.2. The step the
 * code belongs to is recorded, and nothing at or before the recorded step is
 * accepted again: monotonic rather than "not the last code", so an earlier
 * code still inside the skew window is refused too once a later one was taken.
 *
 * The claim is one conditional UPDATE rather than a read and a write, so two
 * requests racing the same code cannot both win: on SQLite the write gate puts
 * one behind the other, on Postgres the second waits on the row lock and then
 * matches nothing. Call it inside the transaction whose work the code buys, so
 * a rollback un-spends it. A refusal is plain `false`, exactly what a wrong
 * code answers — a spent code must not read differently from a bad one.
 */
async function acceptTotp(
  db: DbOrTx,
  member: MemberRow,
  code: string,
  now: Date,
): Promise<boolean> {
  if (!member.mfaSecret) return false;
  const step = verifyTotp(member.mfaSecret, code, now);
  if (step === null) return false;

  const claimed = await db
    .update(members)
    .set({ mfaLastStep: step })
    .where(
      and(
        eq(members.id, member.id),
        or(isNull(members.mfaLastStep), lt(members.mfaLastStep, step)),
      ),
    )
    .returning({ id: members.id });
  return claimed.length > 0;
}

/** How many are left, for the UI to say so before somebody runs out. */
export async function unusedRecoveryCodeCount(db: DbOrTx, memberId: string): Promise<number> {
  return (
    await db
      .select({ id: mfaRecoveryCodes.id })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.memberId, memberId), isNull(mfaRecoveryCodes.usedAt)))
  ).length;
}

/**
 * The same number for everybody at once, because the members list draws it on
 * every row — one grouped query rather than one per member. A member absent
 * from the map has none left, which is a genuine zero and not a missing answer;
 * whether that means anything is `serializeMemberSummary`'s decision, since
 * somebody who never enrolled has no set to count either.
 */
export async function unusedRecoveryCodeCounts(db: DbOrTx): Promise<Map<string, number>> {
  const rows = await db
    .select({ memberId: mfaRecoveryCodes.memberId, count: count() })
    .from(mfaRecoveryCodes)
    .where(isNull(mfaRecoveryCodes.usedAt))
    .groupBy(mfaRecoveryCodes.memberId);
  return new Map(rows.map((row) => [row.memberId, row.count]));
}

/**
 * Puts a member back to un-enrolled: secret gone, codes gone. Their next sign-in
 * walks them through setup again if the workspace still requires it.
 */
export async function resetMemberMfa(db: DbOrTx, memberId: string, now: Date): Promise<void> {
  await db
    .update(members)
    .set({ mfaSecret: null, mfaConfirmedAt: null, mfaLastStep: null, updatedAt: nowIso(now) })
    .where(eq(members.id, memberId));
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.memberId, memberId));
  // Sessions go too, the same way a password reset ends them. An admin resets
  // somebody's second factor because the phone is gone or the account is
  // suspect; leaving live sessions signed in would keep exactly the access the
  // reset is meant to interrupt, now with one factor instead of two.
  await db.delete(sessions).where(eq(sessions.memberId, memberId));
}

/**
 * A fresh ten for an enrolled member who has none left, or null when nothing
 * was needed — which is every ordinary sign-in.
 *
 * This is the whole regeneration story, and it lives on the sign-in path on
 * purpose: recovery codes exist for the moment somebody cannot reach their
 * authenticator, so the one place a new set can be handed over safely is a
 * sign-in that has just proved a factor. It also means the member who spends
 * their **last** code is not told "none left" and sent away — the answer
 * arrives in the same response.
 *
 * The raws are returned once and stored hashed, same rule as an invite link.
 * Call it inside the caller's transaction, with the audit event beside it.
 */
export async function replenishRecoveryCodes(
  db: DbOrTx,
  member: MemberRow,
  now: Date,
): Promise<string[] | null> {
  // Somebody mid-enrolment has no set to run out of, and issuing one before
  // an authenticator is confirmed would hand out the way around a lock that
  // does not exist yet.
  if (member.mfaConfirmedAt === null) return null;
  if ((await unusedRecoveryCodeCount(db, member.id)) > 0) return null;

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await replaceRecoveryCodes(db, member.id, codes, now);
  return codes;
}

/**
 * Empties somebody's recovery codes and leaves everything else alone. There is
 * no way to ask for a new set, so the sign-in that needs one issues it: the
 * next successful two-factor verify finds zero codes and mints ten.
 *
 * Deliberately **not** the session purge `resetMemberMfa` performs above. That
 * one takes the second factor away, so leaving live sessions signed in would
 * keep exactly the access it exists to interrupt. This one takes nothing away —
 * the authenticator still stands and still guards the next sign-in — so ending
 * sessions would be a punishment for an admin's housekeeping.
 */
export async function resetMemberRecoveryCodes(db: DbOrTx, memberId: string): Promise<void> {
  const [member] = await db.select().from(members).where(eq(members.id, memberId));
  if (!member) throw notFound('member');
  if (member.mfaConfirmedAt === null) {
    throw new AppError(
      409,
      'not_enrolled',
      'That member has no authenticator, so there are no codes to reset.',
    );
  }
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.memberId, memberId));
}

/**
 * Turning the requirement off takes every secret and every recovery code with
 * it. A disabled second factor that quietly kept its secrets would come back on
 * with authenticators nobody remembers adding — and would leave the codes
 * sitting in the database in the meantime.
 */
export async function wipeAllMfa(db: DbOrTx, now: Date): Promise<void> {
  await db
    .update(members)
    .set({ mfaSecret: null, mfaConfirmedAt: null, mfaLastStep: null, updatedAt: nowIso(now) });
  await db.delete(mfaRecoveryCodes);
}

async function replaceRecoveryCodes(
  tx: DbOrTx,
  memberId: string,
  codes: string[],
  now: Date,
): Promise<void> {
  await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.memberId, memberId));
  for (const code of codes) {
    await tx.insert(mfaRecoveryCodes).values({
      id: newId(),
      memberId,
      codeHash: hashToken(code),
      usedAt: null,
      createdAt: nowIso(now),
    });
  }
}

/** `k7m2q-4xr9t`: two groups of five, ~49 bits, and no character you can misread. */
function generateRecoveryCode(): string {
  const pick = () =>
    Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]!).join(
      '',
    );
  return `${pick()}-${pick()}`;
}
