import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuditAction } from '@inventory/shared';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { RefreshReuseException, TokenContext, TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { SetupDto } from './dto/setup.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';
import { Public } from '../../common/decorators/public.decorator';
import { AllowedDuringPasswordChange } from '../../common/decorators/allowed-during-password-change.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('setup-status')
  async setupStatus(): Promise<{ setupRequired: boolean }> {
    return { setupRequired: await this.auth.setupRequired() };
  }

  @Public()
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

  @Public()
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

  @Get('me')
  @AllowedDuringPasswordChange()
  async me(@CurrentUser() authed: AuthenticatedUser): Promise<User> {
    const user = await this.auth.findById(authed.userId);
    if (!user || !user.isActive) throw new UnauthorizedException();
    return user;
  }

  @Post('change-password')
  @HttpCode(204)
  @AllowedDuringPasswordChange()
  async changePassword(
    @CurrentUser() authed: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ctx = this.ctxFrom(req);
    const user = await this.auth.changePassword(
      authed.userId,
      dto.currentPassword,
      dto.newPassword,
      ctx,
    );
    // Every other session dies; this one continues on fresh tokens.
    await this.tokens.revokeAllForUser(user.id);
    await this.issueSession(res, user, ctx);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<User> {
    const raw = this.refreshCookie(req);
    if (!raw) throw new UnauthorizedException();
    const ctx = this.ctxFrom(req);

    try {
      const rotated = await this.tokens.rotate(raw, ctx);
      const user = await this.auth.findById(rotated.userId);
      if (!user || !user.isActive) {
        await this.tokens.revokeAllForUser(rotated.userId);
        throw new UnauthorizedException();
      }
      this.setAuthCookies(res, this.tokens.signAccessToken(user), rotated.raw);
      return user;
    } catch (err) {
      if (err instanceof RefreshReuseException) {
        await this.audit.log({
          actorId: err.userId,
          action: AuditAction.LOGIN_FAILED,
          metadata: { reuse: true, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
        });
      }
      if (err instanceof UnauthorizedException) {
        // Dead cookies must not keep re-presenting themselves for days.
        this.clearAuthCookies(res);
      }
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @AllowedDuringPasswordChange()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = this.refreshCookie(req);
    if (raw) await this.tokens.revoke(raw);

    const actor = this.actorFromAccessCookie(req);
    await this.audit.log({
      actorId: actor?.sub ?? null,
      actorEmail: actor?.email ?? null,
      action: AuditAction.LOGOUT,
      metadata: { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
    });

    this.clearAuthCookies(res);
  }

  private clearAuthCookies(res: Response): void {
    const secure = this.config.get<boolean>('cookieSecure') ?? false;
    res.clearCookie(ACCESS_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
    res.clearCookie(REFRESH_COOKIE, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'strict',
      secure,
    });
  }

  private refreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }

  private actorFromAccessCookie(req: Request): { sub: string; email: string } | null {
    const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!token) return null;
    try {
      const payload = this.tokens.verifyAccessToken(token);
      return { sub: payload.sub, email: payload.email };
    } catch {
      return null;
    }
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
