import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditAction, UserRole } from '@inventory/shared';
import { User } from '../users/entities/user.entity';
import { PasswordService } from './password.service';
import { AuditService } from '../audit/audit.service';
import { TokenContext } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

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
    const valid =
      user?.passwordHash != null && (await this.passwords.verify(user.passwordHash, password));

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
}
