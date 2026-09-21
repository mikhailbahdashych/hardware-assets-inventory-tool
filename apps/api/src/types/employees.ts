import type { SerializedEmployee } from '@/lib/serialize.js';

/** One page of the employee list, plus how many people the search matched. */
export interface EmployeeListPage {
  employees: SerializedEmployee[];
  total: number;
}
