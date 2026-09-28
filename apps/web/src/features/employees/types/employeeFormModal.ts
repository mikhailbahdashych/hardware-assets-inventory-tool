import type { Action, EmployeeStatus } from '@inventory/shared';
import type { Employee } from '@/types/api';

export interface EmployeeFormState {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  department: string;
  location: string;
  startDate: string;
  employeeCode: string;
  status: EmployeeStatus;
  returnDueDate: string;
}

export interface EmployeeFormModalProps {
  employee?: Employee;
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
  /** The signed-in member's role — decides whether Admin is an invitation role on offer. */
  viewerRole: string;
  onClose: () => void;
  /** Where to go once the person is gone; defaults to just closing. */
  onDeleted?: () => void;
}
