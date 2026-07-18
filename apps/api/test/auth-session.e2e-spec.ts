import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';

const ADMIN = {
  email: 'root@example.com',
  password: 'correct-horse-battery',
  displayName: 'Root',
};

/** Pulls the raw value of a named cookie out of a Set-Cookie header array. */
function cookieValue(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const hit = cookies.find((c) => c.startsWith(`${name}=`));
  return hit?.split(';')[0].split('=')[1];
}

describe('Auth sessions (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let agent: InstanceType<typeof TestAgent>;

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
    ds = app.get(DataSource);
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('me requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('me returns the logged-in user through the cookie jar', async () => {
    const res = await agent.get('/api/v1/auth/me').expect(200);
    const body = res.body as Record<string, unknown>;
    expect(body.email).toBe('root@example.com');
    expect(body.passwordHash).toBeUndefined();
  });

  it('health stays public', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('refresh rotates both cookies and the old refresh token is revoked in the DB', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);
    const oldRefresh = cookieValue(login, 'sit_refresh');
    expect(oldRefresh).toBeDefined();

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`sit_refresh=${oldRefresh}`])
      .expect(200);
    const newRefresh = cookieValue(refreshed, 'sit_refresh');
    expect(newRefresh).toBeDefined();
    expect(newRefresh).not.toBe(oldRefresh);

    const rows: Array<{ revoked_at: string | null; replaced_by_id: string | null }> =
      await ds.query(
        `SELECT revoked_at, replaced_by_id FROM refresh_tokens ORDER BY created_at ASC`,
      );
    const revoked = rows.filter((r) => r.revoked_at !== null);
    expect(revoked.length).toBeGreaterThanOrEqual(1);
    expect(revoked.some((r) => r.replaced_by_id !== null)).toBe(true);
  });

  it('reusing a rotated token after the grace window revokes every session', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);
    const stolen = cookieValue(login, 'sit_refresh');

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`sit_refresh=${stolen}`])
      .expect(200);

    // Simulate the grace window passing.
    await ds.query(
      `UPDATE refresh_tokens SET revoked_at = revoked_at - interval '31 seconds' WHERE revoked_at IS NOT NULL`,
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`sit_refresh=${stolen}`])
      .expect(401);

    const active: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM refresh_tokens WHERE revoked_at IS NULL`,
    );
    expect(active[0].count).toBe(0);

    const reuseAudit: Array<{ metadata: { reuse?: boolean } }> = await ds.query(
      `SELECT metadata FROM audit_logs WHERE action = 'login_failed' AND metadata->>'reuse' = 'true'`,
    );
    expect(reuseAudit.length).toBeGreaterThanOrEqual(1);
  });

  it('reuse within the grace window is tolerated (multi-tab race)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);
    const shared = cookieValue(login, 'sit_refresh');

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`sit_refresh=${shared}`])
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`sit_refresh=${shared}`])
      .expect(200);
  });

  it('refresh with garbage or missing cookie is 401', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`sit_refresh=${'0'.repeat(64)}`])
      .expect(401);
  });

  it('administrative revocation (change-password) is NOT treated as theft', async () => {
    const s1 = request.agent(app.getHttpServer());
    const s2 = request.agent(app.getHttpServer());
    await s1
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);
    await s2
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);

    const reuseRowsBefore: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'login_failed' AND metadata->>'reuse' = 'true'`,
    );

    await s1
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: ADMIN.password, newPassword: 'a-rotated-password-1' })
      .expect(204);

    // s2's revoked session gets a plain 401 — and s1's fresh session SURVIVES.
    await s2.post('/api/v1/auth/refresh').expect(401);
    await s1.post('/api/v1/auth/refresh').expect(200);
    await s1.get('/api/v1/auth/me').expect(200);

    const reuseRowsAfter: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'login_failed' AND metadata->>'reuse' = 'true'`,
    );
    expect(reuseRowsAfter[0].count).toBe(reuseRowsBefore[0].count);

    // restore the password for the specs below
    await s1
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'a-rotated-password-1', newPassword: ADMIN.password })
      .expect(204);
  });

  it('logout revokes the refresh token, clears cookies, and is audited', async () => {
    const jar = request.agent(app.getHttpServer());
    await jar
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);
    const res = await jar.post('/api/v1/auth/logout').expect(204);

    const cleared = (res.headers['set-cookie'] as unknown as string[]).filter((c) =>
      /sit_(access|refresh)=;/.test(c),
    );
    expect(cleared.length).toBe(2);

    await jar.get('/api/v1/auth/me').expect(401);

    const audits: Array<{ actor_email: string | null }> = await ds.query(
      `SELECT actor_email FROM audit_logs WHERE action = 'logout' ORDER BY id DESC LIMIT 1`,
    );
    expect(audits[0].actor_email).toBe('root@example.com');
  });
});
