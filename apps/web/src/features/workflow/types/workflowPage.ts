import type { WorkflowStatus } from '@inventory/shared';

/** The statuses card, fed the list the page already has. */
export interface StatusesCardProps {
  statuses: WorkflowStatus[];
}

/** One row of it. The card owns the order, so a row is told where it sits. */
export interface StatusRowProps {
  status: WorkflowStatus;
  /** The whole order, because reordering sends every id. */
  order: string[];
  onEdit: (status: WorkflowStatus) => void;
  onDelete: (status: WorkflowStatus) => void;
}
