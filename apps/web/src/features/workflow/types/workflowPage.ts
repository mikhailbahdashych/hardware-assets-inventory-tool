import type { WorkflowStatus, WorkflowTransition } from '@inventory/shared';

/** The statuses card, fed the list the page already has. */
export interface StatusesCardProps {
  statuses: WorkflowStatus[];
}

/**
 * The transition matrix. It is given the stored graph and edits a copy: the
 * page re-mounts it whenever that graph changes, which re-seeds the draft.
 */
export interface MatrixCardProps {
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}
