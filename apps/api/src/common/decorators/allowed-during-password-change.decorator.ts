import { SetMetadata } from '@nestjs/common';

export const ALLOWED_DURING_PASSWORD_CHANGE_KEY = 'allowedDuringPasswordChange';

/**
 * Marks a route as reachable while the user is locked into the forced
 * password-change flow (mustChangePassword). Everything else returns 403.
 */
export const AllowedDuringPasswordChange = () =>
  SetMetadata(ALLOWED_DURING_PASSWORD_CHANGE_KEY, true);
