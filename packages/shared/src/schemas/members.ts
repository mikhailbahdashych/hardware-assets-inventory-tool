import { z } from 'zod';
import { email } from './common.js';

// Members are the accounts that can sign in; employees are the staff who hold
// assets (schemas/employees.ts). The same person may be both, which is what
// the optional employeeId link records — they are never fused into one row.
//
// `role` is a plain string here rather than an enum: roles are rows a
// workspace edits, so no build can list them. Whether the id names one is a
// fact about the database, and the members service asks the roles service.

export const inviteInput = z.object({
  email,
  role: z.string().min(1),
  /** Optional link to the employee record for the same person. */
  employeeId: z.string().min(1).nullable().default(null),
  /**
   * The design's "Send invitation email now" checkbox. Without SMTP nothing is
   * sent either way; the response always carries the link so an admin can copy
   * it. Email arrives in PR 8 and reads this flag then.
   */
  sendEmail: z.boolean().default(true),
});
export type InviteInput = z.infer<typeof inviteInput>;

/** Absent means "leave alone"; an explicit null on employeeId means "unlink". */
export const memberPatchInput = z.object({
  role: z.string().min(1).optional(),
  employeeId: z.string().min(1).nullable().optional(),
});
export type MemberPatchInput = z.infer<typeof memberPatchInput>;

/** Type-to-confirm: the dialog asks for the organization's own name. */
export const workspaceDeleteInput = z.object({ confirmText: z.string().min(1) });
export type WorkspaceDeleteInput = z.infer<typeof workspaceDeleteInput>;
