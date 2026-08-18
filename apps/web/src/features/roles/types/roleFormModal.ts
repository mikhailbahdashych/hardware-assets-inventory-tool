import type { SemanticColor, WorkspaceRole } from '@inventory/shared';

/** The three fields a role is created and renamed with. */
export interface RoleFormState {
  label: string;
  /** Blank is a real answer: the API stores it as NULL. */
  description: string;
  color: SemanticColor;
}

export interface RoleFormModalProps {
  /** Absent for a create — the same mode switch `StatusFormModal` uses. */
  role?: WorkspaceRole;
  onClose: () => void;
}
