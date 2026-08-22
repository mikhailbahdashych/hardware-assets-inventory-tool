import type { DbOrTx } from '@/types/db.js';
import type { AuditEntry } from '@/types/audit.js';
import { auditEvents } from '@/db/schema.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';

/**
 * Writes one audit event. Call it inside the same better-sqlite3 transaction
 * as the mutation it describes — a mutation without its audit row (or the
 * reverse) must be impossible.
 *
 * The coalescing below is the domain rule, not a safety net: the subject
 * columns are nullable because an event need not be about an asset, a person
 * and a member at once, an anonymous flow really is attributed to 'system',
 * and an event with nothing to add stores an empty params object.
 */
export async function writeAudit(
  db: DbOrTx,
  entry: AuditEntry,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(auditEvents)
    .values({
      id: newId(),
      at: nowIso(now),
      type: entry.type,
      action: entry.action,
      actorMemberId: entry.actorMemberId ?? null,
      actorName: entry.actorName ?? 'system',
      assetId: entry.assetId ?? null,
      employeeId: entry.employeeId ?? null,
      memberId: entry.memberId ?? null,
      params: JSON.stringify(entry.params ?? {}),
    })
    .run();
}
