import type { WorkflowStatus } from '@inventory/shared';

export interface DeleteStatusModalProps {
  status: WorkflowStatus;
  /** Where the assets in it may go: every other status a plain asset can hold. */
  destinations: WorkflowStatus[];
  onClose: () => void;
}
