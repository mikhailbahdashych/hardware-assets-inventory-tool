import { and, eq, isNull } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { nowIso } from '../lib/dates.js';
import { createRawToken, hashToken } from '../lib/tokens.js';

export type TokenPurpose = 'invite' | 'password_reset';

const TTL_MS: Record<TokenPurpose, number> = {
  invite: 7 * 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

/**
 * Issues a fresh token (raw value returned once, only the hash is stored) and
 * invalidates any earlier unconsumed token of the same purpose for the member.
 */
export function issueAuthToken(
  db: Db,
  memberId: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): string {
  const raw = createRawToken();
  db.delete(authTokens)
    .where(
      and(
        eq(authTokens.memberId, memberId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    )
    .run();
  db.insert(authTokens)
    .values({
      id: hashToken(raw),
      memberId,
      purpose,
      expiresAt: new Date(now.getTime() + TTL_MS[purpose]).toISOString(),
      createdAt: nowIso(now),
    })
    .run();
  return raw;
}

export function findValidToken(db: Db, raw: string, purpose: TokenPurpose, now: Date = new Date()) {
  const token = db
    .select()
    .from(authTokens)
    .where(eq(authTokens.id, hashToken(raw)))
    .get();
  if (!token) return null;
  if (token.purpose !== purpose) return null;
  if (token.consumedAt) return null;
  if (new Date(token.expiresAt).getTime() <= now.getTime()) return null;
  return token;
}

export function consumeToken(db: DbOrTx, tokenId: string, now: Date = new Date()): void {
  db.update(authTokens)
    .set({ consumedAt: nowIso(now) })
    .where(eq(authTokens.id, tokenId))
    .run();
}
