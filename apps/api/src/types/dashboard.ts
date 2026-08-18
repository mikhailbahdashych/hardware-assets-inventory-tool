import type { AssetCategory, SemanticColor } from '@inventory/shared';
import type { AuditItem } from './admin.js';

// The whole dashboard in one payload. Five widgets, one request: they all read
// the same few tables, and a person toggling a widget off should not change how
// many round trips the page makes.

export interface CategoryCount {
  category: AssetCategory;
  count: number;
}

/**
 * One KPI tile. It carries its own label and colour because statuses are rows
 * an admin edits: the page draws whatever the workspace has, in the workspace's
 * order, without a vocabulary of its own to fall out of date.
 */
export interface StatusCount {
  id: string;
  label: string;
  color: SemanticColor;
  count: number;
}

/** A warranty running out soon; `daysLeft` decides the pill's urgency colour. */
export interface WarrantyExpiry {
  assetId: string;
  name: string;
  assetTag: string;
  warrantyUntil: string;
  daysLeft: number;
}

/** An open ownership record with a return date — offboarding sets those. */
export interface PendingReturn {
  assetId: string;
  assetName: string;
  assetTag: string;
  employeeId: string | null;
  holderName: string;
  expectedReturnDate: string;
}

export interface DashboardPayload {
  assetCount: number;
  /** Every status in sort order, zeros included: a tile is drawn regardless. */
  statusCounts: StatusCount[];
  /** Every category in enum order, so the bars keep their places. */
  categoryCounts: CategoryCount[];
  recentActivity: AuditItem[];
  warrantyExpirations: WarrantyExpiry[];
  pendingReturns: PendingReturn[];
}
