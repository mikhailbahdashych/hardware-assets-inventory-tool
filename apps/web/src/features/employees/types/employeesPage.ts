import type { Action } from '@inventory/shared';

export interface EmployeesPageProps {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
}
