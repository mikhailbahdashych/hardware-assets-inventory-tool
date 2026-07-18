import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { TokenContext, TokenService } from './token.service';
import { SetupDto } from './dto/setup.dto';
import { LoginDto } from './dto/login.dto';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Get('setup-status')
  async setupStatus(): Promise<{ setupRequired: boolean }> {
    return { setupRequired: await this.auth.setupRequired() };
  }

  @Post('setup')
  async setup(
    @Body() dto: SetupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    const ctx = this.ctxFrom(req);
    const user = await this.auth.setup(dto, ctx);
    await this.issueSession(res, user, ctx);
    return user;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    const ctx = this.ctxFrom(req);
    const user = await this.auth.validateLogin(dto.email, dto.password, ctx);
    await this.issueSession(res, user, ctx);
    return user;
  }

  private ctxFrom(req: Request): TokenContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private async issueSession(res: Response, user: User, ctx: TokenContext): Promise<void> {
    const access = this.tokens.signAccessToken(user);
    const { raw: refresh } = await this.tokens.mintRefreshToken(user.id, ctx);
    this.setAuthCookies(res, access, refresh);
  }

  private setAuthCookies(res: Response, access: string, refresh: string): void {
    const secure = this.config.get<boolean>('cookieSecure') ?? false;
    res.cookie(ACCESS_COOKIE, access, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: this.tokens.accessTtlMs(),
    });
    res.cookie(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: REFRESH_COOKIE_PATH,
      maxAge: this.tokens.refreshTtlMs(),
    });
  }
}
