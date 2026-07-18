import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { RefreshReuseException, TokenService } from './token.service';
import { REFRESH_REUSE_GRACE_MS } from './auth.constants';

/** Minimal in-memory stand-in for the RefreshToken repository. */
class FakeRepo {
  rows: RefreshToken[] = [];
  private seq = 0;

  create(data: Partial<RefreshToken>): RefreshToken {
    return Object.assign(new RefreshToken(), { revokedAt: null, replacedById: null }, data);
  }
  async save(row: RefreshToken): Promise<RefreshToken> {
    if (!row.id) {
      row.id = `id-${++this.seq}`;
      row.createdAt = new Date();
      this.rows.push(row);
    }
    return Promise.resolve(row);
  }
  async findOne({ where }: { where: { tokenHash: string } }): Promise<RefreshToken | null> {
    return Promise.resolve(this.rows.find((r) => r.tokenHash === where.tokenHash) ?? null);
  }
  async update(
    criteria: { userId: string },
    patch: Partial<RefreshToken>,
  ): Promise<{ affected: number }> {
    let affected = 0;
    for (const r of this.rows) {
      if (r.userId === criteria.userId && r.revokedAt === null) {
        Object.assign(r, patch);
        affected++;
      }
    }
    return Promise.resolve({ affected });
  }
}

describe('TokenService rotation semantics', () => {
  let repo: FakeRepo;
  let service: TokenService;

  beforeEach(() => {
    repo = new FakeRepo();
    const jwt = new JwtService({});
    const values: Record<string, string> = {
      'jwt.accessSecret': 'test-secret',
      'jwt.accessTtl': '15m',
      'jwt.refreshTtl': '7d',
    };
    const config = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        if (values[key] === undefined) throw new Error(`missing config ${key}`);
        return values[key];
      },
    } as unknown as ConfigService;
    service = new TokenService(repo as unknown as Repository<RefreshToken>, jwt, config);
  });

  it('mints a 64-hex token and stores only its sha256', async () => {
    const { raw, row } = await service.mintRefreshToken('u1', {});
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toBe(raw);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unknown token', async () => {
    await expect(service.rotate('0'.repeat(64), {})).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token without revoking the family', async () => {
    const { raw } = await service.mintRefreshToken('u1', {});
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.rotate(raw, {})).rejects.toThrow(UnauthorizedException);
    expect(repo.rows[0].revokedAt).toBeNull();
  });

  it('happy rotation revokes the old row and links replacedById', async () => {
    const { raw } = await service.mintRefreshToken('u1', {});
    const rotated = await service.rotate(raw, {});
    expect(rotated.userId).toBe('u1');
    expect(rotated.raw).not.toBe(raw);
    const old = repo.rows[0];
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedById).toBe(repo.rows[1].id);
  });

  it('reuse inside the grace window mints a new line without family revocation', async () => {
    const { raw } = await service.mintRefreshToken('u1', {});
    await service.rotate(raw, {});
    const again = await service.rotate(raw, {});
    expect(again.raw).toMatch(/^[0-9a-f]{64}$/);
    const active = repo.rows.filter((r) => r.revokedAt === null);
    expect(active.length).toBe(2);
  });

  it('reuse after the grace window revokes every active token and throws RefreshReuseException', async () => {
    const { raw } = await service.mintRefreshToken('u1', {});
    await service.rotate(raw, {});
    repo.rows[0].revokedAt = new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000);
    await expect(service.rotate(raw, {})).rejects.toThrow(RefreshReuseException);
    expect(repo.rows.filter((r) => r.revokedAt === null)).toHaveLength(0);
  });

  it('revokeAllForUser only touches active rows of that user', async () => {
    await service.mintRefreshToken('u1', {});
    await service.mintRefreshToken('u2', {});
    await service.revokeAllForUser('u1');
    expect(repo.rows.find((r) => r.userId === 'u1')?.revokedAt).not.toBeNull();
    expect(repo.rows.find((r) => r.userId === 'u2')?.revokedAt).toBeNull();
  });

  it('signAccessToken embeds sub/email/role/mcp', () => {
    const token = service.signAccessToken({
      id: 'u9',
      email: 'a@b.c',
      role: 'admin',
      mustChangePassword: true,
    } as never);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(payload.sub).toBe('u9');
    expect(payload.email).toBe('a@b.c');
    expect(payload.role).toBe('admin');
    expect(payload.mcp).toBe(true);
  });
});
