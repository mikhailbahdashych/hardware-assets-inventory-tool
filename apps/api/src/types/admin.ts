import type { AuditActorKind, AuditParams, AuditType } from '@inventory/shared';

/** One activity-log row, rendered to a sentence by the shared renderer. */
export interface AuditItem {
  id: string;
  at: string;
  type: AuditType;
  action: string;
  /**
   * Whether a person, an API token or the system itself did this. The ids
   * behind it are deliberately not sent: `actorName` is what a line reads, and
   * the kind is what a filter groups by. PR 4 draws the pill.
   */
  actorKind: AuditActorKind;
  actorName: string;
  assetId: string | null;
  employeeId: string | null;
  memberId: string | null;
  params: AuditParams;
}

/** How many events sit behind each filter pill, counted over the whole log. */
export type AuditTypeCounts = Record<AuditType | 'all', number>;

export interface AuditPage {
  items: AuditItem[];
  typeCounts: AuditTypeCounts;
  /** Events matching the current filter — what the pager divides into pages. */
  total: number;
}

export interface AuditQuery {
  type?: AuditType;
  limit: number;
  offset: number;
}
