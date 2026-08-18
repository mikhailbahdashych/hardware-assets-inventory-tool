import type { Action } from '@inventory/shared';
import type { Member } from '@/types/api';

export interface ModalHostProps {
  member: Member;
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
}
