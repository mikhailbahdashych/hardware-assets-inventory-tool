import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { UserRole } from '@inventory/shared';
import { AppModule } from './../src/app.module';
import { Roles } from './../src/common/decorators/roles.decorator';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';
import { createUser } from './utils/auth-helpers';

/** Exists only inside this test module — a stand-in for future admin routes. */
@Controller('probe')
class ProbeController {
  @Get('any')
  any(): { ok: boolean } {
    return { ok: true };
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  adminOnly(): { ok: boolean } {
    return { ok: true };
  }
}

const PASSWORD = 'sufficiently-long-pw';

describe('Guard chain (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  const login = (email: string, password = PASSWORD) => {
    const agent = request.agent(app.getHttpServer());
    return agent
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200)
      .then(() => agent);
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

    await createUser(ds, { email: 'admin@t.co', password: PASSWORD, role: UserRole.ADMIN });
    await createUser(ds, { email: 'viewer@t.co', password: PASSWORD, role: UserRole.VIEWER });
    await createUser(ds, {
      email: 'flagged@t.co',
      password: PASSWORD,
      role: UserRole.MANAGER,
      mustChangePassword: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('unauthenticated requests to guarded routes are 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe/any').expect(401);
  });

  it('any authenticated role passes an unrestricted route', async () => {
    const viewer = await login('viewer@t.co');
    await viewer.get('/api/v1/probe/any').expect(200);
  });

  it('viewer is 403 on an admin route; admin passes', async () => {
    const viewer = await login('viewer@t.co');
    await viewer.get('/api/v1/probe/admin').expect(403);
    const admin = await login('admin@t.co');
    await admin.get('/api/v1/probe/admin').expect(200);
  });

  it('a flagged user is locked to the change-password flow', async () => {
    const flagged = await login('flagged@t.co');
    await flagged.get('/api/v1/probe/any').expect(403);
    await flagged.get('/api/v1/auth/me').expect(200);

    await flagged
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'wrong-current-pw', newPassword: 'a-brand-new-long-pw' })
      .expect(400);

    await flagged
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-long-pw' })
      .expect(204);

    // The fresh session (new cookies were set on the 204) is fully unlocked.
    await flagged.get('/api/v1/probe/any').expect(200);

    const me = await flagged.get('/api/v1/auth/me').expect(200);
    expect((me.body as Record<string, unknown>).mustChangePassword).toBe(false);
  });

  it('changing the password revokes every other session', async () => {
    const s1 = await login('admin@t.co');
    const s2 = await login('admin@t.co');

    await s1
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'another-long-password' })
      .expect(204);

    // s2's refresh token was revoked; its refresh must fail.
    await s2.post('/api/v1/auth/refresh').expect(401);

    // restore for any later specs
    await s1
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'another-long-password', newPassword: PASSWORD })
      .expect(204);
  });

  it('old password no longer logs in after a change; audit trail exists', async () => {
    const audits: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'password_change'`,
    );
    expect(audits[0].count).toBeGreaterThanOrEqual(3);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'flagged@t.co', password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'flagged@t.co', password: 'a-brand-new-long-pw' })
      .expect(200);
  });
});
