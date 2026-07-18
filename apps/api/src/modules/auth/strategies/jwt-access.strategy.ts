import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ACCESS_COOKIE } from '../auth.constants';
import { AccessTokenPayload } from '../token.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

const cookieExtractor = (req: Request): string | null =>
  (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE] ?? null;

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return { userId: payload.sub, email: payload.email, role: payload.role, mcp: payload.mcp };
  }
}
