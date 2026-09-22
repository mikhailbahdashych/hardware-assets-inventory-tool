import type { DbOrTx } from '@/types/db.js';
import type { AuditEntry } from '@/types/audit.js';
import { auditEvents } from '@/db/schema.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';

/**
 * Writes one audit event. `await` it inside the same transaction as the
 * mutation it describes, taking that transaction's `tx` — a mutation without
 * its audit row (or the reverse) must be impossible, and an unawaited write is
 * one the COMMIT need not wait for.
 *
 * The coalescing below is the domain rule, not a safety net: the subject
 * columns are nullable because an event need not be about an asset, a person
 * and a member at once, an anonymous flow really is attributed to 'system',
 * and an event with nothing to add stores an empty params object.
 *
 * `actorKind` is written rather than worked out at read time, and that is the
 * whole reason the column exists: `actor_member_id` and `actor_api_token_id`
 * are both nulled when the row they point at goes, so a removed member's
 * history would quietly become the system's and a revoked token's would too.
 * The id says *who*, while it is there; the kind says *what*, for good.
 */
export async function writeAudit(
  db: DbOrTx,
  entry: AuditEntry,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(),
    at: nowIso(now),
    type: entry.type,
    action: entry.action,
    actorMemberId: entry.actorMemberId ?? null,
    actorApiTokenId: entry.actorApiTokenId ?? null,
    // Derived here and nowhere else, so the three kinds cannot be spelled
    // differently by forty call sites. A token beats a member because only one
    // of the two ids is ever set; neither is the anonymous flow above.
    actorKind: entry.actorApiTokenId ? 'token' : entry.actorMemberId ? 'member' : 'system',
    actorName: entry.actorName ?? 'system',
    assetId: entry.assetId ?? null,
    employeeId: entry.employeeId ?? null,
    memberId: entry.memberId ?? null,
    params: JSON.stringify(entry.params ?? {}),
  });
}
