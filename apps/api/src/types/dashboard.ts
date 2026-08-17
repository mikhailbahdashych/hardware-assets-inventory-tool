import type { AssetCategory, AssetStatus } from '@inventory/shared';
import type { AuditItem } from './admin.js';

// The whole dashboard in one payload. Five widgets, one request: they all read
// the same few tables, and a person toggling a widget off should not change how
// many round trips the page makes.

export interface CategoryCount {
  category: AssetCategory;
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
  /** Every status, zeros included: the design draws six KPI cards regardless. */
  statusCounts: Record<AssetStatus, number>;
  /** Every category in enum order, so the bars keep their places. */
  categoryCounts: CategoryCount[];
  recentActivity: AuditItem[];
  warrantyExpirations: WarrantyExpiry[];
  pendingReturns: PendingReturn[];
}
