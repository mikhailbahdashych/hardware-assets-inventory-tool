import { and, eq, isNull } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/types/db.js';
import type { TokenPurpose } from '@/types/auth.js';
// issueAuthToken takes DbOrTx so an invite can be written in the same
// transaction as the member row it belongs to.
import { authTokens } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { createRawToken, hashToken } from '@/lib/tokens.js';

const TTL_MS: Record<TokenPurpose, number> = {
  invite: 7 * 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  // Long enough to read a code off a phone, short enough that a stolen
  // challenge is worthless by the time anybody finds it.
  mfa_challenge: 5 * 60 * 1000,
};

/**
 * Issues a fresh token (raw value returned once, only the hash is stored) and
 * invalidates any earlier unconsumed token of the same purpose for the member.
 */
export async function issueAuthToken(
  db: DbOrTx,
  memberId: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): Promise<string> {
  const raw = createRawToken();
  await db
    .delete(authTokens)
    .where(
      and(
        eq(authTokens.memberId, memberId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    );
  await db.insert(authTokens).values({
    id: hashToken(raw),
    memberId,
    purpose,
    expiresAt: new Date(now.getTime() + TTL_MS[purpose]).toISOString(),
    createdAt: nowIso(now),
  });
  return raw;
}

export async function findValidToken(
  db: Db,
  raw: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
) {
  const [token] = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.id, hashToken(raw)));
  if (!token) return null;
  if (token.purpose !== purpose) return null;
  if (token.consumedAt) return null;
  if (new Date(token.expiresAt).getTime() <= now.getTime()) return null;
  return token;
}

export async function consumeToken(
  db: DbOrTx,
  tokenId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(authTokens)
    .set({ consumedAt: nowIso(now) })
    .where(eq(authTokens.id, tokenId));
}
