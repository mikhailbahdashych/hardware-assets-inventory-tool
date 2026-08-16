import { z } from 'zod';
import { email } from './common.js';

// Auth + preference payloads shared by the API (validation) and the web app
// (form typing). Emails are lowercased at the schema boundary — the whole
// system only ever sees lowercase emails.

const password = z.string().min(10).max(200);
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

export const forgotPasswordInput = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInput>;

export const resetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

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
