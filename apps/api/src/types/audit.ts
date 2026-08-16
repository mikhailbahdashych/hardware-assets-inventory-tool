import type { AuditParams, AuditType } from '@inventory/shared';

/** Who a mutation is attributed to in the audit log. */
export interface Actor {
  id: string;
  displayName: string;
}

/**
 * One audit row as its caller describes it. The optional subject ids are the
 * columns the event may hang off; `params` is the structured payload the
 * shared renderer turns into a sentence.
 */
export interface AuditEntry {
  type: AuditType;
  action: string;
  /** null for anonymous flows; `actorName` then reads 'system'. */
  actorMemberId?: string | null;
  actorName?: string;
  assetId?: string | null;
  employeeId?: string | null;
  memberId?: string | null;
  params?: AuditParams;
}
