import type { Action } from '@inventory/shared';
import type { Member } from '@/types/api';

export interface CustomizeWidgetsModalProps {
  member: Member;
  /** The session's set: the activity widget is offered only with `audit.view`. */
  permissions: Action[];
  onClose: () => void;
}
