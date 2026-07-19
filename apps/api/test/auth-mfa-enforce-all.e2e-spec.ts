import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import * as OTPAuth from 'otpauth';
import { UserRole } from '@inventory/shared';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';
import { createUser, enableMfaDirectly } from './utils/auth-helpers';

@Controller('probe')
class ProbeController {
  @Get('any')
  any(): { ok: boolean } {
    return { ok: true };
  }
}

const PASSWORD = 'sufficiently-long-pw';

describe('MFA_ENFORCE_ALL (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let enrolledSecret: string;

  beforeAll(async () => {
    process.env.MFA_ENFORCE_ALL = 'true';
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
    ds = app.get(DataSource);

    await createUser(ds, { email: 'anyone@t.co', password: PASSWORD, role: UserRole.VIEWER });
    await createUser(ds, { email: 'enrolled@t.co', password: PASSWORD, role: UserRole.VIEWER });
    enrolledSecret = await enableMfaDirectly(app, ds, 'enrolled@t.co');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MFA_ENFORCE_ALL;
  });

  it('locks every unenrolled user to the enrollment flow', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'anyone@t.co', password: PASSWORD })
      .expect(200);
    await agent.get('/api/v1/probe/any').expect(403);
    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/mfa/setup').expect(200);
  });

  it('already-enrolled users go through the normal MFA login and are not locked', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'enrolled@t.co', password: PASSWORD })
      .expect(200);
    expect((res.body as { mfaRequired?: boolean }).mfaRequired).toBe(true);
  });

  it('blocks disabling MFA even without a per-user enforced flag', async () => {
    const code = () =>
      new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enrolledSecret) }).generate();

    const { ticket } = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'enrolled@t.co', password: PASSWORD })
        .expect(200)
    ).body as { ticket: string };

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login/mfa').send({ ticket, code: code() }).expect(200);
    // enrolled@t.co has mfaEnforced=false, but the instance toggle forbids opt-out.
    await agent.delete('/api/v1/auth/mfa').send({ code: code() }).expect(403);
  });
});
