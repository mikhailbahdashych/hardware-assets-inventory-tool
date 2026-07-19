import { SetMetadata } from '@nestjs/common';

export const ALLOWED_DURING_MFA_ENROLLMENT_KEY = 'allowedDuringMfaEnrollment';

/**
 * Marks a route as reachable while the user is locked into forced MFA
 * enrollment (mfaEnforced or MFA_ENFORCE_ALL, without completed enrollment).
 */
export const AllowedDuringMfaEnrollment = () =>
  SetMetadata(ALLOWED_DURING_MFA_ENROLLMENT_KEY, true);
