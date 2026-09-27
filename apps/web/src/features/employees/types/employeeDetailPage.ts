import type { Action } from '@inventory/shared';

export interface EmployeeDetailPageProps {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
  /** The viewer's role id, handed on to the edit form — see `offerableRoles`. */
  viewerRole: string;
}
