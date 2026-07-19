import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditAction, Paginated, UserRole } from '@inventory/shared';
import { User } from './entities/user.entity';
import { generateTempPassword } from './temp-password';
import { PasswordService } from '../auth/password.service';
import { TokenService, TokenContext } from '../auth/token.service';
import { AuditService } from '../audit/audit.service';
import { resetUserMfa } from '../auth/mfa-reset';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/** Serializes admin role/active changes so the last-admin check cannot race. */
const USERS_ADMIN_LOCK_KEY = 7_150_002;

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async list(page: number, pageSize: number, search?: string): Promise<Paginated<User>> {
    const qb = this.users.createQueryBuilder('u').orderBy('u.createdAt', 'ASC');
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      qb.where('(u.email ILIKE :pattern OR u.displayName ILIKE :pattern)', { pattern });
    }
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('user not found');
    return user;
  }

  async create(
    input: { email: string; displayName: string; role: UserRole },
    actor: AuthenticatedUser,
    ctx: TokenContext,
  ): Promise<{ user: User; tempPassword: string }> {
    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({
          email: input.email.toLowerCase(),
          displayName: input.displayName,
          role: input.role,
          passwordHash,
          mustChangePassword: true,
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('a user with this email already exists');
      }
      throw err;
    }

    await this.audit.log({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, displayName: user.displayName, role: user.role },
      metadata: { ip: ctx.ip ?? null },
    });
    return { user, tempPassword };
  }

  async update(
    id: string,
    changes: { displayName?: string; role?: UserRole; isActive?: boolean; mfaEnforced?: boolean },
    actor: AuthenticatedUser,
    ctx: TokenContext,
  ): Promise<User> {
    const demotesOrDeactivates =
      (changes.role !== undefined && changes.role !== UserRole.ADMIN) || changes.isActive === false;

    if (id === actor.userId && demotesOrDeactivates) {
      throw new ConflictException('you cannot demote or deactivate your own account');
    }

    const { user, before } = await this.dataSource.transaction(async (manager) => {
      // Serialize concurrent admin-pool mutations (two parallel demotes must
      // not each see the other admin as still active).
      await manager.query('SELECT pg_advisory_xact_lock($1)', [USERS_ADMIN_LOCK_KEY]);

      const target = await manager.findOne(User, { where: { id } });
      if (!target) throw new NotFoundException('user not found');

      if (target.role === UserRole.ADMIN && target.isActive && demotesOrDeactivates) {
        const otherActiveAdmins = await manager.count(User, {
          where: { role: UserRole.ADMIN, isActive: true },
        });
        if (otherActiveAdmins <= 1) {
          throw new ConflictException('cannot demote or deactivate the last active admin');
        }
      }

      const beforeDiff: Record<string, unknown> = {};
      for (const key of ['displayName', 'role', 'isActive', 'mfaEnforced'] as const) {
        if (changes[key] !== undefined && changes[key] !== target[key]) {
          beforeDiff[key] = target[key];
          (target as Record<string, unknown>)[key] = changes[key];
        }
      }
      const saved = await manager.save(target);
      return { user: saved, before: beforeDiff };
    });

    if (changes.isActive === false) {
      await this.tokens.revokeAllForUser(user.id);
    }

    if (Object.keys(before).length > 0) {
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(before)) {
        after[key] = (user as unknown as Record<string, unknown>)[key];
      }
      await this.audit.log({
        actorId: actor.userId,
        actorEmail: actor.email,
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: user.id,
        before,
        after,
        metadata: { ip: ctx.ip ?? null },
      });
    }
    return user;
  }

  async resetPassword(
    id: string,
    actor: AuthenticatedUser,
    ctx: TokenContext,
  ): Promise<{ tempPassword: string }> {
    const user = await this.findById(id);
    const tempPassword = generateTempPassword();
    user.passwordHash = await this.passwords.hash(tempPassword);
    user.mustChangePassword = true;
    await this.users.save(user);
    await this.tokens.revokeAllForUser(user.id);

    await this.audit.log({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: user.id,
      metadata: { adminReset: true, ip: ctx.ip ?? null },
    });
    return { tempPassword };
  }

  async resetMfa(id: string, actor: AuthenticatedUser, ctx: TokenContext): Promise<void> {
    const user = await this.findById(id);
    await resetUserMfa(this.users.manager, user);

    await this.audit.log({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: AuditAction.MFA_RESET,
      entityType: 'User',
      entityId: user.id,
      metadata: { ip: ctx.ip ?? null },
    });
  }
}
