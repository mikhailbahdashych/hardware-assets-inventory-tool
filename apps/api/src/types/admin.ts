import type { AuditParams, AuditType } from '@inventory/shared';

/** One activity-log row, rendered to a sentence by the shared renderer. */
export interface AuditItem {
  id: string;
  at: string;
  type: AuditType;
  action: string;
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
  /** Events matching the current filter — what "Load more" counts against. */
  total: number;
}

export interface AuditQuery {
  type?: AuditType;
  limit: number;
  offset: number;
}
