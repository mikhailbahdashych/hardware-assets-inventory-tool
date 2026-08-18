import type { WorkspaceRole } from '@inventory/shared';

export interface DeleteRoleModalProps {
  role: WorkspaceRole;
  /**
   * Where the members holding it may go: every other role, the system one
   * included. Handing somebody Admin is a deliberate choice an admin can make,
   * so the list does not decide it for them.
   */
  destinations: WorkspaceRole[];
  onClose: () => void;
}
