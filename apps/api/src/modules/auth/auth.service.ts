import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditAction, UserRole } from '@inventory/shared';
import { User } from '../users/entities/user.entity';
import { PasswordService } from './password.service';
import { AuditService } from '../audit/audit.service';
import { TokenContext } from './token.service';

/** Serializes first-run setup across concurrent requests (arbitrary constant). */
const SETUP_ADVISORY_LOCK_KEY = 7_150_001;

@Injectable()
export class AuthService {
  /** Verified against on unknown emails so response timing never reveals account existence. */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
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

  /** Validates credentials; audits both outcomes. Throws 401 (bad creds) / 403 (inactive). */
  async validateLogin(email: string, password: string, ctx: TokenContext): Promise<User> {
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

    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.audit.log({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.LOGIN,
      metadata: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });
    return user;
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
