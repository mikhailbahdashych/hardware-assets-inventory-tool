import { eq } from 'drizzle-orm';
import type { AppDeps } from '@/types/app.js';
import type { Notification } from '@/types/mail.js';
import type { OrgSettingsRow } from '@/types/settings.js';
import { notificationLog } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';

/**
 * The one place a message actually goes out, and the only place that decides
 * whether it should. Three guards, in the order that costs least:
 *
 * 1. no mailer — this instance sends nothing, by configuration;
 * 2. already sent — `notification_log` remembers, keyed by what "the same
 *    notification" means (a warranty date, a week number, an assignment id);
 * 3. the send itself.
 *
 * The log row is written **after** a successful send, which makes this
 * at-least-once: a crash between the two sends a duplicate on the next run,
 * where writing first would silently lose the message forever. A duplicate
 * warranty alert is a nuisance; a missing one is the feature not working.
 */
export async function sendOnce(deps: AppDeps, notification: Notification): Promise<boolean> {
  if (!deps.mailer) return false;
  if (await alreadySent(deps, notification.dedupeKey)) return false;

  await deps.mailer.send({
    to: notification.to,
    subject: notification.content.subject,
    text: notification.content.text,
    html: notification.content.html,
  });

  await deps.db
    .insert(notificationLog)
    .values({
      id: newId(),
      kind: notification.kind,
      dedupeKey: notification.dedupeKey,
      sentAt: nowIso(deps.now()),
    })
    // Single process on one connection, so this cannot race — the constraint is
    // the backstop for a restart mid-flight, not for concurrency.
    .onConflictDoNothing({ target: notificationLog.dedupeKey })
    .run();

  return true;
}

async function alreadySent(deps: AppDeps, dedupeKey: string): Promise<boolean> {
  return (
    (await deps.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.dedupeKey, dedupeKey))
      .get()) !== undefined
  );
}

/**
 * Whether a settings toggle allows a kind of message. Every scheduled job asks
 * before doing any work, so an instance with everything switched off does no
 * queries either.
 */
export function emailEnabled(
  settings: OrgSettingsRow,
  toggle: keyof Pick<
    OrgSettingsRow,
    'emailWarrantyAlerts' | 'emailReturnReminders' | 'emailInvites' | 'emailWeeklyDigest'
  >,
): boolean {
  return settings[toggle];
}
