import { randomInt } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { RECOVERY_CODE_COUNT } from '@inventory/shared';
import type { Db, DbOrTx } from '@/types/db.js';
import type { MfaEnrolment, MfaStatus } from '@/types/mfa.js';
import type { MemberRow } from '@/types/members.js';
import { members, mfaRecoveryCodes } from '@/db/schema.js';
import { AppError } from '@/lib/errors.js';
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
export function beginEnrolment(
  db: DbOrTx,
  member: MemberRow,
  orgName: string,
  now: Date,
): MfaEnrolment {
  if (member.mfaConfirmedAt) {
    throw new AppError(
      409,
      'mfa_already_enrolled',
      'This account already has an authenticator. An admin has to reset it before a new one can be added.',
    );
  }

  const secret = generateTotpSecret();
  db.update(members)
    .set({ mfaSecret: secret, updatedAt: nowIso(now) })
    .where(eq(members.id, member.id))
    .run();

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
export function confirmEnrolment(db: Db, member: MemberRow, code: string, now: Date): string[] {
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
  db.transaction((tx) => {
    tx.update(members)
      .set({ mfaConfirmedAt: nowIso(now), updatedAt: nowIso(now) })
      .where(eq(members.id, member.id))
      .run();
    replaceRecoveryCodes(tx, member.id, codes, now);
  });
  return codes;
}

/**
 * Whether a code gets somebody in — an authenticator code or one of their
 * recovery codes, decided by what matches rather than by what they claim.
 * A recovery code is spent here, in the same call that accepts it.
 */
export function verifyChallenge(db: Db, member: MemberRow, code: string, now: Date): boolean {
  const candidate = code.trim().toLowerCase();
  if (member.mfaSecret && verifyTotp(member.mfaSecret, code, now)) return true;

  const hash = hashToken(candidate);
  const match = db
    .select()
    .from(mfaRecoveryCodes)
    .where(
      and(
        eq(mfaRecoveryCodes.memberId, member.id),
        eq(mfaRecoveryCodes.codeHash, hash),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .get();
  if (!match) return false;

  db.update(mfaRecoveryCodes)
    .set({ usedAt: nowIso(now) })
    .where(eq(mfaRecoveryCodes.id, match.id))
    .run();
  return true;
}

/** How many are left, for the UI to say so before somebody runs out. */
export function unusedRecoveryCodeCount(db: Db, memberId: string): number {
  return db
    .select({ id: mfaRecoveryCodes.id })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.memberId, memberId), isNull(mfaRecoveryCodes.usedAt)))
    .all().length;
}

/**
 * Puts a member back to un-enrolled: secret gone, codes gone. Their next sign-in
 * walks them through setup again if the workspace still requires it.
 */
export function resetMemberMfa(db: DbOrTx, memberId: string, now: Date): void {
  db.update(members)
    .set({ mfaSecret: null, mfaConfirmedAt: null, updatedAt: nowIso(now) })
    .where(eq(members.id, memberId))
    .run();
  db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.memberId, memberId)).run();
}

/**
 * Turning the requirement off takes every secret and every recovery code with
 * it. A disabled second factor that quietly kept its secrets would come back on
 * with authenticators nobody remembers adding — and would leave the codes
 * sitting in the database in the meantime.
 */
export function wipeAllMfa(db: DbOrTx, now: Date): void {
  db.update(members)
    .set({ mfaSecret: null, mfaConfirmedAt: null, updatedAt: nowIso(now) })
    .run();
  db.delete(mfaRecoveryCodes).run();
}

function replaceRecoveryCodes(tx: DbOrTx, memberId: string, codes: string[], now: Date): void {
  tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.memberId, memberId)).run();
  for (const code of codes) {
    tx.insert(mfaRecoveryCodes)
      .values({
        id: newId(),
        memberId,
        codeHash: hashToken(code),
        usedAt: null,
        createdAt: nowIso(now),
      })
      .run();
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
