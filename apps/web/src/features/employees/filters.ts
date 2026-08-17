import type { Employee } from '@/types/api';

/**
 * The design's employee list has no filter row, but the same live filter the
 * asset list uses is the difference between a usable list and scrolling past
 * two hundred people. It matches on name, email and department.
 */
export function filterEmployees(employees: Employee[], query: string): Employee[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return employees;
  // Somebody with no department recorded matches nothing rather than everything.
  return employees.filter((employee) =>
    [employee.displayName, employee.email, employee.department ?? '', employee.jobTitle ?? ''].some(
      (field) => field.toLowerCase().includes(needle),
    ),
  );
}
