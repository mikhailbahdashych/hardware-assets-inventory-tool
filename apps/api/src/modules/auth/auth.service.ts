import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditAction, UserRole } from '@inventory/shared';
import { User } from '../users/entities/user.entity';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity';
import { generateRecoveryCodes, hashRecoveryCode } from './recovery-codes';
import { resetUserMfa } from './mfa-reset';
import { PasswordService } from './password.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from './crypto.service';
import { TotpService } from './totp.service';
import { TokenContext } from './token.service';

/** Serializes first-run setup across concurrent requests (arbitrary constant). */
const SETUP_ADVISORY_LOCK_KEY = 7_150_001;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Verified against on unknown emails so response timing never reveals account existence. */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(MfaRecoveryCode)
    private readonly recoveryCodes: Repository<MfaRecoveryCode>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
    private readonly config: ConfigService,
  ) {}

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.passwords.hash('timing-equalizer-dummy-password');
    return this.dummyHashPromise;
  }

  async setupRequired(): Promise<boolean> {
    return (await this.users.count()) === 0;
  }

  /** First-run only: creates the initial ADMIN. Transactional re-check closes the race. */
  async setup(
    input: { email: string; password: string; displayName: string },
    ctx: TokenContext,
  ): Promise<User> {
    const email = input.email.toLowerCase();
    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.dataSource.transaction(async (manager) => {
      // READ COMMITTED lets two concurrent setups both see count()==0 —
      // the advisory lock serializes them so the loser sees the winner's row.
      await manager.query('SELECT pg_advisory_xact_lock($1)', [SETUP_ADVISORY_LOCK_KEY]);
      const count = await manager.count(User);
      if (count > 0) throw new ForbiddenException('setup already completed');
      return manager.save(
        manager.create(User, {
          email,
          passwordHash,
          displayName: input.displayName,
          role: UserRole.ADMIN,
          mustChangePassword: false,
        }),
      );
    });

    await this.audit.log({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.SETUP,
      entityType: 'User',
      entityId: user.id,
      metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });
    return user;
  }

  /**
   * Validates email+password only — does NOT record a completed login (the
   * caller decides: full session for password-only users, MFA ticket first
   * for enrolled ones). Audits failures. Throws 401 (bad creds) / 403 (inactive).
   */
  async validateCredentials(email: string, password: string, ctx: TokenContext): Promise<User> {
    const normalized = email.toLowerCase();
    const user = await this.users.findOne({ where: { email: normalized } });
    let valid = false;
    if (user?.passwordHash != null) {
      valid = await this.passwords.verify(user.passwordHash, password);
    } else {
      // Unknown accounts still pay the argon2 cost — no timing oracle.
      await this.passwords.verify(await this.dummyHash(), password);
    }

    if (!user || !valid) {
      await this.audit.log({
        actorEmail: normalized,
        action: AuditAction.LOGIN_FAILED,
        metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
      });
      throw new UnauthorizedException('invalid credentials');
    }
    if (!user.isActive) {
      await this.audit.log({
        actorId: user.id,
        actorEmail: user.email,
        action: AuditAction.LOGIN_FAILED,
        metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, inactive: true },
      });
      throw new ForbiddenException('account is deactivated');
    }
    return user;
  }

  /** Marks a fully completed login (after password, and after TOTP when enabled). */
  async recordLogin(
    user: User,
    ctx: TokenContext,
    viaMfa: boolean,
    usedRecoveryCode = false,
  ): Promise<void> {
    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.audit.log({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.LOGIN,
      metadata: {
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        mfa: viaMfa,
        ...(usedRecoveryCode ? { recoveryCode: true } : {}),
      },
    });
  }

  /**
   * Decrypts the stored TOTP seed and validates the code, returning the
   * matched time-step (null on failure). Decrypt failures are loud in the
   * logs — they mean data corruption or a rotated APP_ENCRYPTION_KEY.
   */
  private matchTotpStep(user: User, code: string): number | null {
    if (!user.mfaSecret) return null;
    let secret: string;
    try {
      secret = this.crypto.decrypt(user.mfaSecret);
    } catch {
      this.logger.warn(
        `cannot decrypt mfaSecret for user ${user.id} — corrupted data or rotated APP_ENCRYPTION_KEY`,
      );
      return null;
    }
    return this.totp.validateStep(code, secret);
  }

  /**
   * Validates a TOTP code AND persists the accepted time-step so the same
   * code can never be replayed (RFC 6238 §5.2). The stamp is written with a
   * conditional UPDATE, so two simultaneous submissions of the same code
   * race here and exactly one wins.
   */
  private async consumeTotp(user: User, code: string): Promise<boolean> {
    const step = this.matchTotpStep(user, code);
    if (step === null) return false;
    const prior = user.mfaLastUsedStep;
    if (prior !== null && step <= prior) return false;
    const stamped = await this.users.update(
      { id: user.id, mfaLastUsedStep: prior === null ? IsNull() : prior },
      { mfaLastUsedStep: step },
    );
    if (!stamped.affected) return false;
    user.mfaLastUsedStep = step;
    return true;
  }

  /** Generates (or regenerates, while unverified) the TOTP secret. 409 once enabled. */
  async startMfaEnrollment(userId: string): Promise<{ otpauthUri: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new ConflictException('mfa is already enabled');

    const secret = this.totp.generateSecret();
    user.mfaSecret = this.crypto.encrypt(secret);
    await this.users.save(user);
    return { otpauthUri: this.totp.otpauthUri(user.email, secret) };
  }

  /** Confirms the code against the pending secret; activates MFA; returns raw recovery codes. */
  async confirmMfaEnrollment(userId: string, code: string, ctx: TokenContext): Promise<string[]> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new ConflictException('mfa is already enabled');
    if (!user.mfaSecret || !(await this.consumeTotp(user, code))) {
      throw new BadRequestException('invalid code');
    }

    user.mfaEnabled = true;
    user.mfaVerifiedAt = new Date();
    await this.users.save(user);

    const codes = generateRecoveryCodes();
    await this.recoveryCodes.delete({ userId: user.id });
    await this.recoveryCodes.save(
      codes.map((c) =>
        this.recoveryCodes.create({ userId: user.id, codeHash: hashRecoveryCode(c) }),
      ),
    );

    await this.audit.log({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.MFA_SETUP,
      entityType: 'User',
      entityId: user.id,
      metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });
    return codes;
  }

  /** Voluntary opt-out. Blocked when enforcement applies; requires a valid second factor. */
  async disableMfa(userId: string, code: string, ctx: TokenContext): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive || !user.mfaEnabled) throw new UnauthorizedException();
    if (user.mfaEnforced || this.mfaEnforceAll()) {
      throw new ForbiddenException('mfa is enforced for this account');
    }
    const passed = await this.verifySecondFactor(user, code);
    if (!passed.ok) throw new BadRequestException('invalid code');

    await resetUserMfa(this.users.manager, user);

    await this.audit.log({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.MFA_DISABLED,
      entityType: 'User',
      entityId: user.id,
      metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });
    return user;
  }

  private mfaEnforceAll(): boolean {
    return this.config.get<boolean>('mfaEnforceAll') === true;
  }

  /** TOTP first (replay-guarded); falls back to atomically consuming a recovery code. */
  async verifySecondFactor(
    user: User,
    code: string,
  ): Promise<{ ok: boolean; recoveryCode?: boolean }> {
    if (await this.consumeTotp(user, code)) return { ok: true };
    const row = await this.recoveryCodes.findOne({
      where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: IsNull() },
    });
    if (!row) return { ok: false };
    // Conditional update — two concurrent presentations of the same code
    // race here and exactly one wins.
    const consumed = await this.recoveryCodes.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!consumed.affected) return { ok: false };
    return { ok: true, recoveryCode: true };
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /** Verifies the current password, sets the new one, clears the forced flag. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: TokenContext,
  ): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const valid =
      user.passwordHash != null &&
      (await this.passwords.verify(user.passwordHash, currentPassword));
    if (!valid) throw new BadRequestException('current password is incorrect');

    user.passwordHash = await this.passwords.hash(newPassword);
    user.mustChangePassword = false;
    await this.users.save(user);

    await this.audit.log({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: user.id,
      metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });
    return user;
  }
}
