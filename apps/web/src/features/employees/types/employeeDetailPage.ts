import type { Action } from '@inventory/shared';

export interface EmployeeDetailPageProps {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
}
