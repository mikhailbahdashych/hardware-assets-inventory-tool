import { and, count, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { ADMIN_ROLE, type Action, type NotificationParams } from '@inventory/shared';
import type { NotificationsPayload } from '@inventory/shared';
import type { NotifyInput } from '@/types/notifications.js';
import type { DbOrTx } from '@/types/db.js';
import { members, notifications, rolePermissions } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';

/**
 * The inbox. One row per member per event, written in the same transaction as
 * whatever caused it — the audit log's rule, for the same reason. Params are
 * snapshots; the shared renderer turns them into the sentence the bell shows.
 */

/** Writes one row. False means the dedupe key already delivered this one. */
export async function notify(db: DbOrTx, input: NotifyInput, now: Date): Promise<boolean> {
  const written = await db
    .insert(notifications)
    .values({
      id: newId(),
      memberId: input.memberId,
      kind: input.kind,
      params: JSON.stringify(input.params),
      // Only the jobs pass one. NULL is "may repeat", and both engines let a
      // unique index hold any number of NULLs.
      dedupeKey: input.dedupeKey ?? null,
      createdAt: nowIso(now),
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return written.length > 0;
}

/**
 * The personal half: events addressed to a person reach the member account
 * linked to their employee record — the only bridge there is, since employees
 * do not sign in. No link, no row; the operational surfaces still show it.
 */
export async function notifyLinkedMember(
  db: DbOrTx,
  employeeId: string,
  input: Omit<NotifyInput, 'memberId'>,
  now: Date,
): Promise<number> {
  const linked = await db.select().from(members).where(eq(members.employeeId, employeeId));
  let written = 0;
  for (const member of linked) {
    if (await notify(db, { ...input, memberId: member.id }, now)) written += 1;
  }
  return written;
}

/**
 * The operational half: events addressed to whoever does a job, resolved by
 * permission rather than role name — a workspace that grants `assets.edit`
 * to its own "Fleet manager" gets the notifications with the grant. Admin is
 * the system role whose set is every action by definition and stores no rows,
 * so it is named alongside the subquery.
 */
export async function notifyActionHolders(
  db: DbOrTx,
  action: Action,
  input: Omit<NotifyInput, 'memberId'>,
  now: Date,
): Promise<number> {
  const holders = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.status, 'active'),
        or(
          eq(members.role, ADMIN_ROLE),
          inArray(
            members.role,
            db
              .select({ roleId: rolePermissions.roleId })
              .from(rolePermissions)
              .where(eq(rolePermissions.action, action)),
          ),
        ),
      ),
    );
  let written = 0;
  for (const holder of holders) {
    if (await notify(db, { ...input, memberId: holder.id }, now)) written += 1;
  }
  return written;
}

export const DEFAULT_INBOX_LIMIT = 50;

/** How long an inbox row is worth reading. The bell shows fifty; ninety days is history. */
const INBOX_RETENTION_DAYS = 90;

/**
 * The reading horizon. The inbox shows nothing older, and maintenance deletes
 * anything older except a row whose dedupe key a job may still ask for — see
 * `runMaintenance`. That row is memory, not reading, so it is not listed.
 */
export const inboxCutoff = (now: Date): string =>
  new Date(now.getTime() - INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
export const MAX_INBOX_LIMIT = 200;

export async function listNotifications(
  db: DbOrTx,
  memberId: string,
  now: Date,
  limit: number = DEFAULT_INBOX_LIMIT,
  offset = 0,
): Promise<NotificationsPayload> {
  const readable = and(
    eq(notifications.memberId, memberId),
    gte(notifications.createdAt, inboxCutoff(now)),
  );
  const rows = await db
    .select()
    .from(notifications)
    .where(readable)
    // Total, with the id as the tiebreak: a scan writes its rows under one
    // `now`, and rows free to swap places would repeat or vanish at a page
    // boundary — the lists' rule, see apps/api/CLAUDE.md.
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .offset(offset);
  const [total] = await db.select({ value: count() }).from(notifications).where(readable);
  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(readable, isNull(notifications.readAt)));
  return {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      // NOT NULL DEFAULT '{}' and only ever written by JSON.stringify above.
      params: JSON.parse(row.params) as NotificationParams,
      createdAt: row.createdAt,
      readAt: row.readAt,
    })),
    unreadCount: unread === undefined ? 0 : unread.value,
    total: total === undefined ? 0 : total.value,
  };
}

/** Opening the panel is the gesture; everything seen stops being new. */
export async function markAllRead(db: DbOrTx, memberId: string, now: Date): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: nowIso(now) })
    .where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt)));
}
