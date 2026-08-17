import type { DashboardPayload, Member } from '@/types/api';

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
  data: DashboardPayload;
}

export interface WarrantyExpirationsProps {
  data: DashboardPayload;
}

export interface PendingReturnsProps {
  data: DashboardPayload;
}
