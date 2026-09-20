import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
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
 * permission rather than role name — a workspace that grants `assets.manage`
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
export const MAX_INBOX_LIMIT = 200;

export async function listNotifications(
  db: DbOrTx,
  memberId: string,
  limit: number = DEFAULT_INBOX_LIMIT,
  offset = 0,
): Promise<NotificationsPayload> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.memberId, memberId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
  const [total] = await db
    .select({ value: count() })
    .from(notifications)
    .where(eq(notifications.memberId, memberId));
  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt)));
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
