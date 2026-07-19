import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import * as OTPAuth from 'otpauth';
import { UserRole } from '@inventory/shared';
import { AppModule } from './../src/app.module';
import { CryptoService } from './../src/modules/auth/crypto.service';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';
import { createUser } from './utils/auth-helpers';

/** Stand-in for any future non-auth route; exists only in this test module. */
@Controller('probe')
class ProbeController {
  @Get('any')
  any(): { ok: boolean } {
    return { ok: true };
  }
}

const PASSWORD = 'sufficiently-long-pw';

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get('secret') as string;
}

function totpNow(secret: string, offsetMs = 0): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate({
    timestamp: Date.now() + offsetMs,
  });
}

describe('MFA enrollment lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  const loginAgent = async (email: string): Promise<InstanceType<typeof TestAgent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    return agent;
  };

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
    ds = app.get(DataSource);

    await createUser(ds, { email: 'volunteer@t.co', password: PASSWORD, role: UserRole.VIEWER });
    await createUser(ds, {
      email: 'forced@t.co',
      password: PASSWORD,
      role: UserRole.MANAGER,
      mfaEnforced: true,
    });
    await createUser(ds, {
      email: 'both@t.co',
      password: PASSWORD,
      role: UserRole.VIEWER,
      mfaEnforced: true,
      mustChangePassword: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let volunteerCodes: string[] = [];

  it('voluntary enrollment: setup → verify → recovery codes → mfa login required', async () => {
    const agent = await loginAgent('volunteer@t.co');
    // A second device, logged in before enrollment — must die when MFA turns on.
    const otherDevice = await loginAgent('volunteer@t.co');

    const setup = await agent.post('/api/v1/auth/mfa/setup').expect(200);
    const uri = (setup.body as { otpauthUri: string }).otpauthUri;
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    const secret = secretFromUri(uri);

    await agent.post('/api/v1/auth/mfa/verify').send({ code: '000000' }).expect(400);

    const verify = await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: totpNow(secret) })
      .expect(200);
    volunteerCodes = (verify.body as { recoveryCodes: string[] }).recoveryCodes;
    expect(volunteerCodes).toHaveLength(10);
    for (const c of volunteerCodes) expect(c).toMatch(/^[0-9a-z]{5}-[0-9a-z]{5}$/);

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect((me.body as Record<string, unknown>).mfaEnabled).toBe(true);

    // The enrolling session survives on fresh cookies; the other device is revoked.
    await otherDevice.post('/api/v1/auth/refresh').expect(401);

    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'volunteer@t.co', password: PASSWORD })
      .expect(200);
    expect((relogin.body as { mfaRequired?: boolean }).mfaRequired).toBe(true);

    await agent.post('/api/v1/auth/mfa/setup').expect(409);
  });

  it('a recovery code completes login exactly once', async () => {
    const code = volunteerCodes[0];
    const ticketRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'volunteer@t.co', password: PASSWORD })
      .expect(200);
    const { ticket } = ticketRes.body as { ticket: string };

    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket, code })
      .expect(200);

    const again = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'volunteer@t.co', password: PASSWORD })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: (again.body as { ticket: string }).ticket, code })
      .expect(401);
  });

  it('an enforced-but-unenrolled user is locked to the enrollment flow', async () => {
    const agent = await loginAgent('forced@t.co');
    await agent.get('/api/v1/probe/any').expect(403);
    await agent.get('/api/v1/auth/me').expect(200);

    const setup = await agent.post('/api/v1/auth/mfa/setup').expect(200);
    const secret = secretFromUri((setup.body as { otpauthUri: string }).otpauthUri);
    await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: totpNow(secret) })
      .expect(200);

    // Fresh cookies from verify clear the mfp claim.
    await agent.get('/api/v1/probe/any').expect(200);
  });

  it('enforced users cannot disable MFA; voluntary users can (and login reverts to single-step)', async () => {
    const [{ mfa_secret }]: Array<{ mfa_secret: string }> = await ds.query(
      `SELECT mfa_secret FROM users WHERE email = 'forced@t.co'`,
    );
    expect(mfa_secret).toBeTruthy();

    // forced@t.co is enrolled now — full mfa login to get a session.
    const t = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'forced@t.co', password: PASSWORD })
      .expect(200);
    const crypto = app.get(CryptoService);
    const forcedSecret = crypto.decrypt(mfa_secret);
    const forcedAgent = request.agent(app.getHttpServer());
    // +30s: the enrollment already consumed the current step (replay guard).
    await forcedAgent
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: (t.body as { ticket: string }).ticket, code: totpNow(forcedSecret, 30_000) })
      .expect(200);
    await forcedAgent
      .delete('/api/v1/auth/mfa')
      .send({ code: totpNow(forcedSecret, 30_000) })
      .expect(403);

    // Voluntary user disables with a TOTP code.
    const vTicket = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'volunteer@t.co', password: PASSWORD })
      .expect(200);
    const [{ mfa_secret: vSecretEnc }]: Array<{ mfa_secret: string }> = await ds.query(
      `SELECT mfa_secret FROM users WHERE email = 'volunteer@t.co'`,
    );
    const vSecret = crypto.decrypt(vSecretEnc);
    const vAgent = request.agent(app.getHttpServer());
    await vAgent
      .post('/api/v1/auth/login/mfa')
      .send({ ticket: (vTicket.body as { ticket: string }).ticket, code: totpNow(vSecret, 30_000) })
      .expect(200);
    // Disable with a recovery code — the TOTP step was just consumed above.
    await vAgent.delete('/api/v1/auth/mfa').send({ code: volunteerCodes[1] }).expect(204);

    const plain = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'volunteer@t.co', password: PASSWORD })
      .expect(200);
    expect((plain.body as Record<string, unknown>).mfaRequired).toBeUndefined();

    const audits: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'mfa_disabled'`,
    );
    expect(audits[0].count).toBe(1);
  });

  it('a user flagged for both password change and MFA completes password first, then enrollment', async () => {
    const agent = await loginAgent('both@t.co');

    // Locked by BOTH guards; change-password is allowed through both.
    await agent.get('/api/v1/probe/any').expect(403);
    await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'a-fresh-long-password' })
      .expect(204);

    // Still locked by MFA enrollment (fresh cookies carry mfp=true).
    await agent.get('/api/v1/probe/any').expect(403);
    const setup = await agent.post('/api/v1/auth/mfa/setup').expect(200);
    const secret = secretFromUri((setup.body as { otpauthUri: string }).otpauthUri);
    await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: totpNow(secret) })
      .expect(200);
    await agent.get('/api/v1/probe/any').expect(200);
  });
});
