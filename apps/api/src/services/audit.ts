import type { DbOrTx } from '@/types/db.js';
import type { Actor, AuditActor, AuditEntry } from '@/types/audit.js';
import { auditEvents } from '@/db/schema.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';

/**
 * A service's `Actor` as the audit log records it, decided here once so no
 * service has to remember to pass a token's id through: an actor carrying
 * `apiTokenId` is that token, one with a member id is that member. `Actor.id`
 * is null only for a token, so an actor with neither is a caller broken — and
 * recording it as "system" under a person's or a token's name would be a row
 * lying about who acted.
 */
export function auditActor(actor: Actor): AuditActor {
  if (actor.apiTokenId !== undefined) {
    return { kind: 'token', id: actor.apiTokenId, name: actor.displayName };
  }
  if (actor.id !== null) return { kind: 'member', id: actor.id, name: actor.displayName };
  throw new Error(`The actor "${actor.displayName}" has neither a member id nor an API token id.`);
}

/**
 * Writes one audit event. `await` it inside the same transaction as the
 * mutation it describes, taking that transaction's `tx` — a mutation without
 * its audit row (or the reverse) must be impossible, and an unawaited write is
 * one the COMMIT need not wait for.
 *
 * The actor columns are read off the variant rather than coalesced: a member
 * or a token stores its id and its name, and only the system variant stores
 * the name 'system' with neither id. The remaining `?? null` are the subject
 * columns' meaning — an event need not be about an asset, a person and a
 * member at once — and an event with nothing to add stores an empty params
 * object.
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
  const { actor } = entry;
  await db.insert(auditEvents).values({
    id: newId(),
    at: nowIso(now),
    type: entry.type,
    action: entry.action,
    actorMemberId: actor.kind === 'member' ? actor.id : null,
    actorApiTokenId: actor.kind === 'token' ? actor.id : null,
    actorKind: actor.kind,
    actorName: actor.kind === 'system' ? 'system' : actor.name,
    assetId: entry.assetId ?? null,
    employeeId: entry.employeeId ?? null,
    memberId: entry.memberId ?? null,
    params: JSON.stringify(entry.params ?? {}),
  });
}
