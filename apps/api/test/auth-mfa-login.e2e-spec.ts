import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import * as OTPAuth from 'otpauth';
import * as jwt from 'jsonwebtoken';
import { UserRole } from '@inventory/shared';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';
import { createUser, enableMfaDirectly } from './utils/auth-helpers';

const PASSWORD = 'sufficiently-long-pw';

function totpNow(secret: string, offsetMs = 0): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate({
    timestamp: Date.now() + offsetMs,
  });
}

describe('MFA login (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let mfaSecret: string;

  const login = (email: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: PASSWORD });

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
    ds = app.get(DataSource);

    await createUser(ds, { email: 'plain@t.co', password: PASSWORD, role: UserRole.VIEWER });
    await createUser(ds, { email: 'secured@t.co', password: PASSWORD, role: UserRole.MANAGER });
    mfaSecret = await enableMfaDirectly(app, ds, 'secured@t.co');
  });

  afterAll(async () => {
    await app.close();
  });

  it('password-only accounts keep the plain login flow', async () => {
    const res = await login('plain@t.co').expect(200);
    expect((res.body as Record<string, unknown>).email).toBe('plain@t.co');
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('sit_access='))).toBe(true);
  });

  it('MFA accounts get a ticket and NO cookies from the password step', async () => {
    const res = await login('secured@t.co').expect(200);
    const body = res.body as { mfaRequired?: boolean; ticket?: string };
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.ticket).toBe('string');
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('sit_'))).toBe(false);
  });

  it('a valid TOTP code completes the login with cookies and an mfa-flagged audit row', async () => {
    const { ticket } = (await login('secured@t.co').expect(200)).body as { ticket: string };
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket, code: totpNow(mfaSecret) })
      .expect(200);
    expect((res.body as Record<string, unknown>).email).toBe('secured@t.co');
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('sit_access='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('sit_refresh='))).toBe(true);

    const rows: Array<{ metadata: { mfa?: boolean } }> = await ds.query(
      `SELECT metadata FROM audit_logs WHERE action = 'login' AND actor_email = 'secured@t.co' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0].metadata.mfa).toBe(true);
  });

  it('a wrong code is 401 and audited as login_mfa_failed', async () => {
    const { ticket } = (await login('secured@t.co').expect(200)).body as { ticket: string };
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket, code: '000000' })
      .expect(401);
    const rows: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'login_mfa_failed'`,
    );
    expect(rows[0].count).toBeGreaterThanOrEqual(1);
  });

  it('rejects forged, wrong-purpose, and expired tickets', async () => {
    const code = totpNow(mfaSecret);
    const [{ id: userId }]: Array<{ id: string }> = await ds.query(
      `SELECT id FROM users WHERE email = 'secured@t.co'`,
    );

    const forged = jwt.sign({ sub: userId, purpose: 'mfa' }, 'not-the-real-secret');
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: forged, code })
      .expect(401);

    const wrongPurpose = jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET as string);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: wrongPurpose, code })
      .expect(401);

    const expired = jwt.sign(
      { sub: userId, purpose: 'mfa' },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: -10 },
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: expired, code })
      .expect(401);
  });

  it('an access cookie value can never act as a ticket', async () => {
    const plainLogin = await login('plain@t.co').expect(200);
    const cookies = plainLogin.headers['set-cookie'] as unknown as string[];
    const access = cookies
      .find((c) => c.startsWith('sit_access='))!
      .split(';')[0]
      .split('=')[1];
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: access, code: totpNow(mfaSecret) })
      .expect(401);
  });
});

describe('MFA login throttling (e2e, throttling active)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.THROTTLE_DISABLED = 'true';
  });

  it('returns 429 after 5 rapid second-factor attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login/mfa')
        .send({ ticket: 'junk', code: '000000' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: 'junk', code: '000000' })
      .expect(429);
  });
});
