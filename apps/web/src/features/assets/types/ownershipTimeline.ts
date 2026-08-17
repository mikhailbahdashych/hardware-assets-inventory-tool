import type { Assignment } from '@/types/api';

export interface OwnershipTimelineProps {
  history: Assignment[];
  assetCreatedAt: string;
}
