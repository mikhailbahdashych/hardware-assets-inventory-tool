import type { EmployeeStatus, Role } from '@inventory/shared';
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
  role: Role;
  onClose: () => void;
  onDeleted?: () => void;
}
