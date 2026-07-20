import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { UserRole } from '@inventory/shared';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';
import { createUser, enableMfaDirectly } from './utils/auth-helpers';

const PASSWORD = 'sufficiently-long-pw';

describe('Users admin (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: InstanceType<typeof TestAgent>;

  const loginAgent = async (email: string, password = PASSWORD) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return agent;
  };

  const idOf = async (email: string): Promise<string> => {
    const rows: Array<{ id: string }> = await ds.query(`SELECT id FROM users WHERE email = $1`, [
      email,
    ]);
    return rows[0].id;
  };

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
    ds = app.get(DataSource);

    await createUser(ds, { email: 'root@t.co', password: PASSWORD, role: UserRole.ADMIN });
    await createUser(ds, { email: 'manager@t.co', password: PASSWORD, role: UserRole.MANAGER });
    await createUser(ds, { email: 'viewer@t.co', password: PASSWORD, role: UserRole.VIEWER });
    admin = await loginAgent('root@t.co');
  });

  afterAll(async () => {
    await app.close();
  });

  it('every route is admin-only', async () => {
    const manager = await loginAgent('manager@t.co');
    const viewer = await loginAgent('viewer@t.co');
    const someId = '00000000-0000-4000-8000-000000000000';
    await manager.get('/api/v1/users').expect(403);
    await viewer.get('/api/v1/users').expect(403);
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    await manager.post('/api/v1/users').send({}).expect(403);
    await manager.patch(`/api/v1/users/${someId}`).send({}).expect(403);
    await manager.post(`/api/v1/users/${someId}/reset-password`).expect(403);
    await manager.post(`/api/v1/users/${someId}/mfa/reset`).expect(403);
    await viewer.get(`/api/v1/users/${someId}`).expect(403);
  });

  it('lists users with pagination and escaped search', async () => {
    const res = await admin.get('/api/v1/users?pageSize=2&page=1').expect(200);
    const body = res.body as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(3);

    const search = await admin.get('/api/v1/users?search=manager').expect(200);
    expect((search.body as { total: number }).total).toBe(1);

    // % must be literal, not a wildcard
    const literal = await admin.get('/api/v1/users?search=%25').expect(200);
    expect((literal.body as { total: number }).total).toBe(0);
  });

  let newUserId: string;
  let tempPassword: string;

  it('creates a user with a one-time temp password and forced change', async () => {
    const res = await admin
      .post('/api/v1/users')
      .send({ email: 'New.Hire@T.co', displayName: 'New Hire', role: UserRole.MANAGER })
      .expect(201);
    const body = res.body as {
      user: { id: string; email: string; mustChangePassword: boolean; passwordHash?: string };
      tempPassword: string;
    };
    expect(body.user.email).toBe('new.hire@t.co');
    expect(body.user.mustChangePassword).toBe(true);
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.tempPassword).toMatch(/^[0-9a-z]{16}$/);
    newUserId = body.user.id;
    tempPassword = body.tempPassword;

    await admin
      .post('/api/v1/users')
      .send({ email: 'new.hire@t.co', displayName: 'Dup', role: UserRole.VIEWER })
      .expect(409);

    const audit: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'create' AND entity_type = 'User'`,
    );
    expect(audit[0].count).toBe(1);
  });

  it('the temp password logs in but is locked to the change-password flow', async () => {
    const hire = await loginAgent('new.hire@t.co', tempPassword);
    await hire.get('/api/v1/users').expect(403); // manager role anyway, but locked first by mcp
    const me = await hire.get('/api/v1/auth/me').expect(200);
    expect((me.body as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
    await hire
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: tempPassword, newPassword: 'brand-new-password-1' })
      .expect(204);
    const after = await hire.get('/api/v1/auth/me').expect(200);
    expect((after.body as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
  });

  it('updates role/displayName with an audit diff of changed fields only', async () => {
    await admin
      .patch(`/api/v1/users/${newUserId}`)
      .send({ role: UserRole.VIEWER, displayName: 'Renamed Hire' })
      .expect(200);
    const rows: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> =
      await ds.query(
        `SELECT before, after FROM audit_logs WHERE action = 'update' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
        [newUserId],
      );
    expect(rows[0].before).toEqual({ role: 'manager', displayName: 'New Hire' });
    expect(rows[0].after).toEqual({ role: 'viewer', displayName: 'Renamed Hire' });
  });

  it('deactivation revokes the target sessions immediately', async () => {
    const hire = await loginAgent('new.hire@t.co', 'brand-new-password-1');
    await admin.patch(`/api/v1/users/${newUserId}`).send({ isActive: false }).expect(200);
    await hire.post('/api/v1/auth/refresh').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'new.hire@t.co', password: 'brand-new-password-1' })
      .expect(403);
    await admin.patch(`/api/v1/users/${newUserId}`).send({ isActive: true }).expect(200);
  });

  it('protects the last active admin and the actor themselves', async () => {
    const rootId = await idOf('root@t.co');
    // Self-demotion and self-deactivation are refused outright.
    await admin.patch(`/api/v1/users/${rootId}`).send({ role: UserRole.VIEWER }).expect(409);
    await admin.patch(`/api/v1/users/${rootId}`).send({ isActive: false }).expect(409);

    // Second admin joins and establishes a session.
    const res = await admin
      .post('/api/v1/users')
      .send({ email: 'admin2@t.co', displayName: 'Second Admin', role: UserRole.ADMIN })
      .expect(201);
    const admin2Id = (res.body as { user: { id: string } }).user.id;
    const admin2Temp = (res.body as { tempPassword: string }).tempPassword;
    const admin2 = await loginAgent('admin2@t.co', admin2Temp);
    await admin2
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: admin2Temp, newPassword: 'second-admin-pass-1' })
      .expect(204);

    // Demoting admin2 is fine — root remains an active admin.
    await admin.patch(`/api/v1/users/${admin2Id}`).send({ role: UserRole.MANAGER }).expect(200);

    // admin2's access token still carries the admin role claim (≤15 min
    // staleness by design), but every mutating route re-checks the actor
    // against the DATABASE — the demoted admin gets 403 everywhere, closing
    // the takeover primitives (reset the last admin's password, mint a new
    // admin) that pure claim checks would have allowed.
    await admin2.patch(`/api/v1/users/${rootId}`).send({ role: UserRole.MANAGER }).expect(403);
    await admin2.patch(`/api/v1/users/${rootId}`).send({ isActive: false }).expect(403);
    await admin2.post(`/api/v1/users/${rootId}/reset-password`).expect(403);
    await admin2
      .post('/api/v1/users')
      .send({ email: 'evil@t.co', displayName: 'Evil', role: UserRole.ADMIN })
      .expect(403);
    // Self-service resets are refused for admins on their own account.
    await admin.post(`/api/v1/users/${rootId}/reset-password`).expect(409);
    await admin.post(`/api/v1/users/${rootId}/mfa/reset`).expect(409);

    const admins: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true`,
    );
    expect(admins[0].count).toBe(1);
  });

  it('admin password reset issues a temp password and kills sessions', async () => {
    const viewerId = await idOf('viewer@t.co');
    const viewer = await loginAgent('viewer@t.co');
    const res = await admin.post(`/api/v1/users/${viewerId}/reset-password`).expect(200);
    const { tempPassword: temp } = res.body as { tempPassword: string };
    expect(temp).toMatch(/^[0-9a-z]{16}$/);

    await viewer.post('/api/v1/auth/refresh').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@t.co', password: PASSWORD })
      .expect(401);
    const back = await loginAgent('viewer@t.co', temp);
    const me = await back.get('/api/v1/auth/me').expect(200);
    expect((me.body as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  it('admin MFA reset clears enrollment, revokes sessions, and audits the admin as actor', async () => {
    const managerId = await idOf('manager@t.co');
    await enableMfaDirectly(app, ds, 'manager@t.co');
    await admin.post(`/api/v1/users/${managerId}/mfa/reset`).expect(204);

    const rows: Array<{ mfa_enabled: boolean; mfa_secret: string | null }> = await ds.query(
      `SELECT mfa_enabled, mfa_secret FROM users WHERE id = $1`,
      [managerId],
    );
    expect(rows[0].mfa_enabled).toBe(false);
    expect(rows[0].mfa_secret).toBeNull();

    const rootId = await idOf('root@t.co');
    const audit: Array<{ actor_id: string }> = await ds.query(
      `SELECT actor_id FROM audit_logs WHERE action = 'mfa_reset' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit[0].actor_id).toBe(rootId);
  });

  it('mfaEnforced toggle flows through to the user payload', async () => {
    const viewerId = await idOf('viewer@t.co');
    const res = await admin
      .patch(`/api/v1/users/${viewerId}`)
      .send({ mfaEnforced: true })
      .expect(200);
    expect((res.body as { mfaEnforced: boolean }).mfaEnforced).toBe(true);
  });
});
