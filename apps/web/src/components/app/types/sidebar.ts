import type { Action } from '@inventory/shared';
import type { Member } from '@/types/api';

export interface SidebarProps {
  member: Member;
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
  orgName: string;
  onSignOut: () => void;
}
