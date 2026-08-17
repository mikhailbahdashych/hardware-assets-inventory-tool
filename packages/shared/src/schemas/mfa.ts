import { z } from 'zod';

// Two-factor payloads. A "code" here is either a six-digit authenticator code
// or a recovery code, and the server decides which by shape — so the login
// screen needs one input, not a mode switch nobody wants to think about.

/** The digits an authenticator shows. Spaces because apps display them grouped. */
export const totpCodeInput = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'));

/**
 * Either kind of code, unvalidated in shape beyond "somebody typed something":
 * telling a wrong recovery code from a wrong authenticator code before checking
 * either would say which one the account uses.
 */
export const mfaChallengeInput = z.object({
  challengeToken: z.string().min(1),
  code: z.string().trim().min(1, 'Enter a code.').max(64),
});
export type MfaChallengeInput = z.infer<typeof mfaChallengeInput>;

/** Confirming enrolment: prove the authenticator was actually added. */
export const mfaConfirmInput = z.object({ code: totpCodeInput });
export type MfaConfirmInput = z.infer<typeof mfaConfirmInput>;

/** How many recovery codes an enrolment issues, and their shape. */
export const RECOVERY_CODE_COUNT = 10;
/** Two groups of five, hyphenated — readable off a screen, ~50 bits of entropy. */
export const RECOVERY_CODE_PATTERN = /^[a-z0-9]{5}-[a-z0-9]{5}$/;
