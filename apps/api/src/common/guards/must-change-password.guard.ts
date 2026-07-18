import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ALLOWED_DURING_PASSWORD_CHANGE_KEY } from '../decorators/allowed-during-password-change.decorator';

/**
 * While mustChangePassword is set (mcp claim), the account is locked down to
 * routes marked @AllowedDuringPasswordChange. Public routes pass through
 * (no user attached).
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user?.mcp) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWED_DURING_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    throw new ForbiddenException('password change required');
  }
}
