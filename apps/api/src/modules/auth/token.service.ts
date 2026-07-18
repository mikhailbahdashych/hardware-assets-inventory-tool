import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { REFRESH_REUSE_GRACE_MS } from './auth.constants';

/** Thrown when a rotated-away refresh token is presented after the grace window. */
export class RefreshReuseException extends UnauthorizedException {
  constructor(readonly userId: string) {
    super('refresh token reuse detected');
  }
}

export interface TokenContext {
  ip?: string;
  userAgent?: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  /** mustChangePassword — gates everything except the change-password flow. */
  mcp: boolean;
}

const TTL_PATTERN = /^(\d+)([smhd])$/;
const TTL_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      mcp: user.mustChangePassword,
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: Math.floor(this.ttlMs('jwt.accessTtl') / 1000),
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async mintRefreshToken(
    userId: string,
    ctx: TokenContext,
  ): Promise<{ raw: string; row: RefreshToken }> {
    const raw = randomBytes(32).toString('hex');
    const row = await this.refreshTokens.save(
      this.refreshTokens.create({
        userId,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + this.ttlMs('jwt.refreshTtl')),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      }),
    );
    return { raw, row };
  }

  /**
   * Exchange a presented refresh token for a new one.
   * - unknown/expired → 401
   * - rotated away, within grace → benign multi-tab race: mint a fresh line
   * - rotated away, after grace → theft: revoke every active token, 401
   */
  async rotate(raw: string, ctx: TokenContext): Promise<{ userId: string; raw: string }> {
    const row = await this.refreshTokens.findOne({ where: { tokenHash: this.hashToken(raw) } });
    if (!row) throw new UnauthorizedException();
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException();

    if (row.revokedAt) {
      const withinGrace =
        row.replacedById !== null && Date.now() <= row.revokedAt.getTime() + REFRESH_REUSE_GRACE_MS;
      if (withinGrace) {
        const minted = await this.mintRefreshToken(row.userId, ctx);
        return { userId: row.userId, raw: minted.raw };
      }
      await this.revokeAllForUser(row.userId);
      throw new RefreshReuseException(row.userId);
    }

    const minted = await this.mintRefreshToken(row.userId, ctx);
    row.revokedAt = new Date();
    row.replacedById = minted.row.id;
    await this.refreshTokens.save(row);
    return { userId: row.userId, raw: minted.raw };
  }

  /** Revoke one presented token (logout). Unknown tokens are a no-op. */
  async revoke(raw: string): Promise<void> {
    const row = await this.refreshTokens.findOne({ where: { tokenHash: this.hashToken(raw) } });
    if (row && row.revokedAt === null) {
      row.revokedAt = new Date();
      await this.refreshTokens.save(row);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  accessTtlMs(): number {
    return this.ttlMs('jwt.accessTtl');
  }

  refreshTtlMs(): number {
    return this.ttlMs('jwt.refreshTtl');
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private ttlMs(configKey: string): number {
    const ttl = this.config.getOrThrow<string>(configKey);
    const match = TTL_PATTERN.exec(ttl);
    if (!match) throw new Error(`Invalid TTL for ${configKey}: ${ttl}`);
    return parseInt(match[1], 10) * TTL_UNIT_MS[match[2]];
  }
}
