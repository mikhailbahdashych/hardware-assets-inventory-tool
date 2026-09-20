import { z } from 'zod';
import { email } from './common.js';

// Auth + preference payloads shared by the API (validation) and the web app
// (form typing). Emails are lowercased at the schema boundary — the whole
// system only ever sees lowercase emails.

/**
 * The one password rule, everywhere a password is set: setup, accepting an
 * invite, an admin-issued reset, changing your own, an admin setting one.
 * `PASSWORD_HINT` is the same sentence for form hints, so the rule and the
 * words describing it cannot drift.
 */
export const PASSWORD_HINT =
  'At least 10 characters, with an upper- and lower-case letter, a number and a special character';
const password = z
  .string()
  .min(10, { error: PASSWORD_HINT })
  .max(200)
  .refine(
    (value) =>
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^A-Za-z0-9]/.test(value),
    { error: PASSWORD_HINT },
  );
const name = z.string().trim().min(1).max(120);

export const setupInput = z.object({
  orgName: z.string().trim().min(1).max(120),
  name,
  email,
  password,
});
export type SetupInput = z.infer<typeof setupInput>;

export const loginInput = z.object({
  email,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const resetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const changePasswordInput = z.object({
  // min(1), not the password rule: this one only has to match what is stored,
  // and an account predating a stricter rule still owns its password.
  currentPassword: z.string().min(1),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

/** An admin handing somebody a fresh password — the last resort recovery. */
export const setPasswordInput = z.object({ newPassword: password });
export type SetPasswordInput = z.infer<typeof setPasswordInput>;

export const acceptInviteInput = z.object({
  token: z.string().min(1),
  name,
  password,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>;

export const prefsPatchInput = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  widgets: z.record(z.string(), z.boolean()).optional(),
});
export type PrefsPatchInput = z.infer<typeof prefsPatchInput>;
