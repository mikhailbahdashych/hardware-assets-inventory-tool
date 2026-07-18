import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Routes a password-change-pending user may still reach. */
const ALLOWED_PATHS = new Set([
  '/api/v1/auth/change-password',
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
]);

/**
 * While mustChangePassword is set (mcp claim), the account is locked down to
 * the change-password flow. Public routes pass through (no user attached).
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser; path: string }>();
    if (!request.user?.mcp) return true;
    if (ALLOWED_PATHS.has(request.path)) return true;
    throw new ForbiddenException('password change required');
  }
}
