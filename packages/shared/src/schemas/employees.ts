import { z } from 'zod';
import { EMPLOYEE_STATUSES } from '../enums.js';
import { email, nullableDate, nullableText } from './common.js';

// Employees are the people who hold assets; they have no app access on their
// own (that is a member — see schemas/auth.ts). Email is the identity used to
// match CSV imports and member invites, so it is required and lowercased.

const personName = z.string().trim().min(1).max(80);

/** New people are always Active; offboarding is a deliberate edit. */
export const employeeCreateInput = z.object({
  firstName: personName,
  lastName: personName,
  email,
  jobTitle: nullableText(120).default(null),
  department: nullableText(80).default(null),
  location: nullableText(80).default(null),
  employeeCode: nullableText(40).default(null),
  startDate: nullableDate.default(null),
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateInput>;

export const employeePatchInput = z.object({
  firstName: personName.optional(),
  lastName: personName.optional(),
  email: email.optional(),
  jobTitle: nullableText(120).optional(),
  department: nullableText(80).optional(),
  location: nullableText(80).optional(),
  employeeCode: nullableText(40).optional(),
  startDate: nullableDate.optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  /**
   * Set when the status flips to offboarding: the date their open assignments
   * become due back. Return reminders (PR 8) read it.
   */
  returnDueDate: nullableDate.optional(),
});
export type EmployeePatchInput = z.infer<typeof employeePatchInput>;
