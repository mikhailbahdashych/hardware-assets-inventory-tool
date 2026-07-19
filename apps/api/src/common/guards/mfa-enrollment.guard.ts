import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_ENROLLMENT_REQUIRED_MESSAGE } from '@inventory/shared';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ALLOWED_DURING_MFA_ENROLLMENT_KEY } from '../decorators/allowed-during-mfa-enrollment.decorator';

/**
 * While the mfp claim is set (MFA enforced but not yet enrolled), the account
 * is locked down to routes marked @AllowedDuringMfaEnrollment. Public routes
 * pass through (no user attached).
 */
@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user?.mfp) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWED_DURING_MFA_ENROLLMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    throw new ForbiddenException(MFA_ENROLLMENT_REQUIRED_MESSAGE);
  }
}
