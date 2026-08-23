import { randomInt } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
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
 * Starts enrolment: a fresh secret, stored unconfirmed. Re-entering enrolment
 * replaces the previous unconfirmed secret, because somebody who abandoned a
 * half-scanned QR and came back should get a clean one rather than a secret
 * their authenticator may or may not still hold.
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
  if (!verifyTotp(member.mfaSecret, code, now)) {
    throw new AppError(422, 'mfa_code_invalid', 'That code is not right — try the current one.');
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await db.transaction(async (tx) => {
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
  if (member.mfaSecret && verifyTotp(member.mfaSecret, code, now)) return true;

  const hash = hashToken(candidate);
  const [match] = await db
    .select()
    .from(mfaRecoveryCodes)
    .where(
      and(
        eq(mfaRecoveryCodes.memberId, member.id),
        eq(mfaRecoveryCodes.codeHash, hash),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    );
  if (!match) return false;

  await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: nowIso(now) })
    .where(eq(mfaRecoveryCodes.id, match.id));
  return true;
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
    .set({ mfaSecret: null, mfaConfirmedAt: null, updatedAt: nowIso(now) })
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
  if (!member) throw notFound('That member');
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
  await db.update(members).set({ mfaSecret: null, mfaConfirmedAt: null, updatedAt: nowIso(now) });
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
