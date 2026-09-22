import { desc, eq } from 'drizzle-orm';
import {
  API_SCOPES,
  TOKEN_TTL_LABELS,
  type ApiScope,
  type ApiTokenCreateInput,
} from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Actor } from '@/types/audit.js';
import type { Db, DbOrTx } from '@/types/db.js';
import type { ApiTokenSummary, MintedApiToken, ResolvedApiToken } from '@/types/api-tokens.js';
import { apiTokens } from '@/db/schema.js';
import { addDays, nowIso } from '@/lib/dates.js';
import { notFound } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { createRawToken, hashToken } from '@/lib/tokens.js';
import { writeAudit } from './audit.js';

// Every rule about API tokens, in one place. Two of them run through the whole
// file: the raw value exists exactly once, in the response that minted it
// (the database keeps sha256 of it, like sessions and invite links), and
// revoking is deleting — there is nothing to mark inactive when the only copy
// of the credential is in somebody's deployment secrets.

/** Recognisable at a glance, and to a secret scanner reading a repository. */
const TOKEN_PREFIX = 'invt_';

/** Only this file's queries name it, so it stays beside them. */
type ApiTokenRow = typeof apiTokens.$inferSelect;

/** Scopes this build declares. A stored one outside it is a leftover. */
const KNOWN_SCOPES = new Set<string>(API_SCOPES);

/**
 * How stale `last_used_at` may get before a use writes it again. Without it
 * every read through a token would also be a write, which on one SQLite file is
 * a lock the rest of the workspace waits behind.
 */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * The column is written by `JSON.stringify` of a zod-validated array and by
 * nothing else, so it parses. A scope this build no longer declares is dropped
 * rather than carried: a grant nothing can name must not read as permission.
 */
function storedScopes(row: ApiTokenRow): ApiScope[] {
  return (JSON.parse(row.scopes) as string[]).filter((scope): scope is ApiScope =>
    KNOWN_SCOPES.has(scope),
  );
}

const serialize = (row: ApiTokenRow): ApiTokenSummary => ({
  id: row.id,
  name: row.name,
  scopes: storedScopes(row),
  expiresAt: row.expiresAt,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
});

/**
 * Mints one token. The raw value is returned here and nowhere else, ever —
 * `apps/web` shows it once and the admin copies it, exactly like an invite
 * link.
 */
export async function mintApiToken(
  deps: AppDeps,
  actor: Actor,
  input: ApiTokenCreateInput,
): Promise<MintedApiToken> {
  const now = deps.now();
  const raw = `${TOKEN_PREFIX}${createRawToken()}`;
  const row: ApiTokenRow = {
    id: newId(),
    name: input.name,
    tokenHash: hashToken(raw),
    scopes: JSON.stringify(input.scopes),
    // Null is the "Unlimited" the admin picked — a value, not an absence.
    expiresAt: input.expiresInDays === null ? null : nowIso(addDays(now, input.expiresInDays)),
    createdByMemberId: actor.id,
    createdByName: actor.displayName,
    createdAt: nowIso(now),
    lastUsedAt: null,
  };

  await deps.db.transaction(async (tx) => {
    await tx.insert(apiTokens).values(row);
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'token.created',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: {
          name: input.name,
          // The reach as a number rather than eight labels: the log is a line,
          // and the token's page is where the scopes themselves are read.
          scopeCount: input.scopes.length,
          // The label the admin picked, snapshotted like every other label in
          // the log. Total over what zod let through, so no fallback is needed.
          expiry: TOKEN_TTL_LABELS[`${input.expiresInDays}`],
        },
      },
      now,
    );
  });

  return { token: raw, apiToken: serialize(row) };
}

/** Every token, newest first, with `id` as the tiebreaker the server owns. */
export async function listApiTokens(db: DbOrTx): Promise<ApiTokenSummary[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  return rows.map(serialize);
}

/** Revoking is deleting: the raw value is out there, and nothing recalls it. */
export async function revokeApiToken(deps: AppDeps, actor: Actor, id: string): Promise<void> {
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(apiTokens).where(eq(apiTokens.id, id));
    if (!row) throw notFound('That API token');

    await tx.delete(apiTokens).where(eq(apiTokens.id, id));
    await writeAudit(
      tx,
      {
        type: 'auth',
        action: 'token.revoked',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { name: row.name },
      },
      now,
    );
  });
}

/**
 * A raw Bearer token to the credential behind it, or null for anything that
 * does not check out — unknown and expired answer the same way, because the
 * caller may not learn which it was.
 *
 * Wired to nothing yet: the Bearer plugin that consumes it is the next PR. It
 * is tested now because the rules it carries — hash lookup, the expiry
 * refusal, the last-used throttle — are the ones a door must not get wrong.
 */
export async function resolveApiToken(
  db: Db,
  raw: string,
  now: Date,
): Promise<ResolvedApiToken | null> {
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(raw)));
  if (!row) return null;
  // Expired is refused, never deleted: the row stays on the page with its
  // "Expired" pill, so an integrator can see why their calls stopped.
  if (row.expiresAt !== null && new Date(row.expiresAt).getTime() <= now.getTime()) return null;

  const usedAt = row.lastUsedAt;
  if (usedAt === null || now.getTime() - new Date(usedAt).getTime() >= LAST_USED_THROTTLE_MS) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: nowIso(now) })
      .where(eq(apiTokens.id, row.id));
  }

  return { id: row.id, name: row.name, scopes: storedScopes(row) };
}
