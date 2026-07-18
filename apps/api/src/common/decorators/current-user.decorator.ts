import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** What JwtAccessStrategy.validate attaches to request.user. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
  /** mustChangePassword claim from the access token. */
  mcp: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
