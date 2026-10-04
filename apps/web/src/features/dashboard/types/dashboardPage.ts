import type { AuditLogItem, DashboardPayload, Member } from '@/types/api';

export interface DashboardPageProps {
  member: Member;
}

export interface StatusCountsProps {
  data: DashboardPayload;
}

export interface CategoryBarsProps {
  data: DashboardPayload;
}

export interface RecentActivityProps {
  /** Only drawn when the payload carries the feed at all. */
  items: AuditLogItem[];
}

export interface WarrantyExpirationsProps {
  data: DashboardPayload;
}

export interface PendingReturnsProps {
  data: DashboardPayload;
}
