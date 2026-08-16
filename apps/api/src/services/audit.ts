import type { AuditType } from '@inventory/shared';
import type { DbOrTx } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/dates.js';

export type AuditEntry = {
  type: AuditType;
  action: string;
  /** null for anonymous flows; actorName then defaults to 'system'. */
  actorMemberId?: string | null;
  actorName?: string;
  assetId?: string | null;
  employeeId?: string | null;
  memberId?: string | null;
  params?: Record<string, unknown>;
};

/**
 * Writes one audit event. Call it inside the same better-sqlite3 transaction
 * as the mutation it describes — a mutation without its audit row (or the
 * reverse) must be impossible.
 */
export function writeAudit(db: DbOrTx, entry: AuditEntry, now: Date = new Date()): void {
  db.insert(auditEvents)
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
