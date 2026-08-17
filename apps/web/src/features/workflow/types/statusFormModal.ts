import type { SemanticColor, WorkflowStatus } from '@inventory/shared';

/** The two fields a status is created and renamed with. */
export interface StatusFormState {
  label: string;
  color: SemanticColor;
}

export interface StatusFormModalProps {
  /** Absent for a create — the same mode switch `AssetFormModal` uses. */
  status?: WorkflowStatus;
  onClose: () => void;
}
