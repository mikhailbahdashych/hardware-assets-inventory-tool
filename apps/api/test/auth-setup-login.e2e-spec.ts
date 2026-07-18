import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';

const ADMIN = {
  email: 'Admin@Example.com',
  password: 'correct-horse-battery',
  displayName: 'First Admin',
};

async function createApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
  await app.init();
  return app;
}

describe('Auth setup + login (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    await resetTestDatabase();
    app = await createApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('setup-status is true on a fresh instance', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/setup-status').expect(200);
    expect(res.body).toEqual({ setupRequired: true });
  });

  it('rejects setup with a weak password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/setup')
      .send({ ...ADMIN, password: 'short' })
      .expect(400);
  });

  it('exactly one of two concurrent setups wins; the winner gets cookies, lowercased email, no hash leaks', async () => {
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/auth/setup').send(ADMIN),
      request(app.getHttpServer()).post('/api/v1/auth/setup').send(ADMIN),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 403]);
    const [{ count }]: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM users`,
    );
    expect(count).toBe(1);

    const res = r1.status === 201 ? r1 : r2;
    const body = res.body as Record<string, unknown>;
    expect(body.email).toBe('admin@example.com');
    expect(body.role).toBe('admin');
    expect(body.passwordHash).toBeUndefined();
    expect(body.mfaSecret).toBeUndefined();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('sit_access='));
    const refresh = cookies.find((c) => c.startsWith('sit_refresh='));
    expect(access).toContain('HttpOnly');
    expect(access).toContain('SameSite=Lax');
    expect(access).toContain('Path=/');
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('SameSite=Strict');
    expect(refresh).toContain('Path=/api/v1/auth');

    const audits: Array<{ action: string }> = await ds.query(
      `SELECT action FROM audit_logs WHERE action = 'setup'`,
    );
    expect(audits).toHaveLength(1);
  });

  it('second setup attempt is rejected and setup-status flips to false', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/setup').send(ADMIN).expect(403);
    const res = await request(app.getHttpServer()).get('/api/v1/auth/setup-status').expect(200);
    expect(res.body).toEqual({ setupRequired: false });
  });

  it('login succeeds with mixed-case email and sets cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ADMIN@example.COM', password: ADMIN.password })
      .expect(200);
    expect((res.body as Record<string, unknown>).email).toBe('admin@example.com');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('sit_access='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('sit_refresh='))).toBe(true);
  });

  it('login with a wrong password is 401 and audited as login_failed', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'definitely-wrong-1' })
      .expect(401);
    const audits: Array<{ actor_email: string }> = await ds.query(
      `SELECT actor_email FROM audit_logs WHERE action = 'login_failed'`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].actor_email).toBe('admin@example.com');
  });

  it('login for a deactivated user is 403', async () => {
    await ds.query(`UPDATE users SET is_active = false WHERE email = 'admin@example.com'`);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(403);
    await ds.query(`UPDATE users SET is_active = true WHERE email = 'admin@example.com'`);
  });

  it('successful login is audited with ip metadata', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);
    const rows: Array<{ metadata: { ip?: string } }> = await ds.query(
      `SELECT metadata FROM audit_logs WHERE action = 'login' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0].metadata).toHaveProperty('ip');
  });
});

describe('Auth login throttling (e2e, throttling active)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    process.env.THROTTLE_DISABLED = 'true';
  });

  it('returns 429 after 5 rapid login attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password-xx' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-xx' })
      .expect(429);
  });
});
