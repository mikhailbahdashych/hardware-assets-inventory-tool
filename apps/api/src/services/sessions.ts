import { eq, lt } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Config } from '@/config.js';
import type { Db } from '@/db/client.js';
import { members, sessions } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { createRawToken, hashToken } from '@/lib/tokens.js';

export const SESSION_COOKIE = 'inv_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDING_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;

export function createSession(db: Db, memberId: string, now: Date = new Date()) {
  const raw = createRawToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.insert(sessions)
    .values({ id: hashToken(raw), memberId, expiresAt, createdAt: nowIso(now) })
    .run();
  return { raw, expiresAt };
}

export function setSessionCookie(
  reply: FastifyReply,
  raw: string,
  expiresAt: string,
  config: Config,
): void {
  reply.setCookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.cookieSecure,
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', secure: config.cookieSecure });
}

export function deleteSession(db: Db, rawToken: string): void {
  db.delete(sessions)
    .where(eq(sessions.id, hashToken(rawToken)))
    .run();
}

export function revokeMemberSessions(db: Db, memberId: string): void {
  db.delete(sessions).where(eq(sessions.memberId, memberId)).run();
}

export function pruneExpiredSessions(db: Db, now: Date = new Date()): void {
  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
}

/**
 * Resolves a raw cookie token to its member. Deletes expired sessions on
 * sight, slides the expiry when under 15 days remain, and bumps the member's
 * last_active_at at most every 5 minutes.
 */
export function resolveSession(db: Db, rawToken: string, now: Date = new Date()) {
  const id = hashToken(rawToken);
  const session = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }

  if (new Date(session.expiresAt).getTime() - now.getTime() < SLIDING_THRESHOLD_MS) {
    db.update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() })
      .where(eq(sessions.id, id))
      .run();
  }

  const member = db.select().from(members).where(eq(members.id, session.memberId)).get();
  if (!member) return null;

  if (
    !member.lastActiveAt ||
    now.getTime() - new Date(member.lastActiveAt).getTime() > LAST_ACTIVE_THROTTLE_MS
  ) {
    db.update(members)
      .set({ lastActiveAt: nowIso(now) })
      .where(eq(members.id, member.id))
      .run();
  }

  return member;
}
