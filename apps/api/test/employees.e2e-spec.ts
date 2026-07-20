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
import { createUser } from './utils/auth-helpers';

const PASSWORD = 'sufficiently-long-pw';

describe('Employees (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: InstanceType<typeof TestAgent>;
  let manager: InstanceType<typeof TestAgent>;
  let viewer: InstanceType<typeof TestAgent>;

  const loginAgent = async (email: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    return agent;
  };

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication<INestApplication<App>>());
    await app.init();
    ds = app.get(DataSource);

    await createUser(ds, { email: 'admin@t.co', password: PASSWORD, role: UserRole.ADMIN });
    await createUser(ds, { email: 'manager@t.co', password: PASSWORD, role: UserRole.MANAGER });
    await createUser(ds, { email: 'viewer@t.co', password: PASSWORD, role: UserRole.VIEWER });
    admin = await loginAgent('admin@t.co');
    manager = await loginAgent('manager@t.co');
    viewer = await loginAgent('viewer@t.co');
  });

  afterAll(async () => {
    await app.close();
  });

  let adaId: string;

  it('managers create employees; input is trimmed and lowercased where it matters', async () => {
    const res = await manager
      .post('/api/v1/employees')
      .send({
        firstName: '  Ada ',
        lastName: 'Lovelace',
        email: ' Ada.Lovelace@Corp.CO ',
        employeeNumber: ' HR-0001 ',
        department: 'Engineering',
        title: 'Staff Engineer',
      })
      .expect(201);
    const body = res.body as Record<string, unknown>;
    adaId = body.id as string;
    expect(body.firstName).toBe('Ada');
    expect(body.email).toBe('ada.lovelace@corp.co');
    expect(body.employeeNumber).toBe('HR-0001');
    expect(body.isActive).toBe(true);

    const audit: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'create' AND entity_type = 'Employee'`,
    );
    expect(audit[0].count).toBe(1);
  });

  it('rejects duplicate email and duplicate employee number with named 409s', async () => {
    const dupEmail = await manager
      .post('/api/v1/employees')
      .send({ firstName: 'Eve', lastName: 'Clone', email: 'ADA.LOVELACE@corp.co' })
      .expect(409);
    expect((dupEmail.body as { message: string }).message).toContain('email');

    const dupNumber = await manager
      .post('/api/v1/employees')
      .send({ firstName: 'Eve', lastName: 'Clone', employeeNumber: 'HR-0001' })
      .expect(409);
    expect((dupNumber.body as { message: string }).message).toContain('employee number');
  });

  it('role matrix: viewer reads but cannot write; anonymous is 401', async () => {
    await viewer.get('/api/v1/employees').expect(200);
    await viewer.get(`/api/v1/employees/${adaId}`).expect(200);
    await viewer.post('/api/v1/employees').send({ firstName: 'X', lastName: 'Y' }).expect(403);
    await viewer.patch(`/api/v1/employees/${adaId}`).send({ title: 'Nope' }).expect(403);
    await viewer.delete(`/api/v1/employees/${adaId}`).expect(403);
    await manager.delete(`/api/v1/employees/${adaId}`).expect(403); // delete is admin-only
    await request(app.getHttpServer()).get('/api/v1/employees').expect(401);
  });

  it('search matches name/email/number with escaped wildcards; isActive filters', async () => {
    await manager
      .post('/api/v1/employees')
      .send({ firstName: 'Grace', lastName: 'Hopper', employeeNumber: 'HR-0002' })
      .expect(201);
    const grace = await admin.get('/api/v1/employees?search=hopper').expect(200);
    expect((grace.body as { total: number }).total).toBe(1);

    const byNumber = await admin.get('/api/v1/employees?search=HR-0001').expect(200);
    expect((byNumber.body as { total: number }).total).toBe(1);

    const literal = await admin.get('/api/v1/employees?search=%25').expect(200);
    expect((literal.body as { total: number }).total).toBe(0);

    // Deactivate Grace, then filter both ways.
    const graceId = (grace.body as { items: Array<{ id: string }> }).items[0].id;
    await manager.patch(`/api/v1/employees/${graceId}`).send({ isActive: false }).expect(200);
    const activeOnly = await admin.get('/api/v1/employees?isActive=true').expect(200);
    expect(
      (activeOnly.body as { items: Array<{ id: string }> }).items.some((e) => e.id === graceId),
    ).toBe(false);
    const inactiveOnly = await admin.get('/api/v1/employees?isActive=false').expect(200);
    expect((inactiveOnly.body as { total: number }).total).toBe(1);
  });

  it('PATCH distinguishes untouched, changed, and explicitly cleared fields', async () => {
    const res = await manager
      .patch(`/api/v1/employees/${adaId}`)
      .send({ title: 'Principal Engineer', department: null })
      .expect(200);
    const body = res.body as Record<string, unknown>;
    expect(body.title).toBe('Principal Engineer');
    expect(body.department).toBeNull();
    expect(body.email).toBe('ada.lovelace@corp.co'); // untouched

    const rows: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> =
      await ds.query(
        `SELECT before, after FROM audit_logs WHERE action = 'update' AND entity_type = 'Employee' ORDER BY id DESC LIMIT 1`,
      );
    expect(rows[0].before).toEqual({ title: 'Staff Engineer', department: 'Engineering' });
    expect(rows[0].after).toEqual({ title: 'Principal Engineer', department: null });
  });

  it('a no-op PATCH writes no audit row', async () => {
    const auditCountBefore: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'update' AND entity_type = 'Employee'`,
    );
    await manager
      .patch(`/api/v1/employees/${adaId}`)
      .send({ title: 'Principal Engineer' })
      .expect(200);
    const auditCountAfter: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'update' AND entity_type = 'Employee'`,
    );
    expect(auditCountAfter[0].count).toBe(auditCountBefore[0].count);
  });

  it('delete is blocked while assignment history references the employee', async () => {
    // Manufacture history directly: an asset type + asset + a returned assignment.
    await ds.query(`INSERT INTO asset_types (name) VALUES ('E2EType') ON CONFLICT DO NOTHING`);
    const [{ id: typeId }]: Array<{ id: string }> = await ds.query(
      `SELECT id FROM asset_types WHERE name = 'E2EType'`,
    );
    const [{ id: assetId }]: Array<{ id: string }> = await ds.query(
      `INSERT INTO assets (asset_tag, name, asset_type_id) VALUES ('E2E-1', 'Laptop', $1) RETURNING id`,
      [typeId],
    );
    await ds.query(
      `INSERT INTO assignments (asset_id, employee_id, returned_at) VALUES ($1, $2, now())`,
      [assetId, adaId],
    );

    const res = await admin.delete(`/api/v1/employees/${adaId}`).expect(409);
    expect((res.body as { message: string }).message).toContain('deactivate');

    // A history-free employee deletes cleanly, with a before-state audit row.
    const disposable = await manager
      .post('/api/v1/employees')
      .send({ firstName: 'Tmp', lastName: 'Person' })
      .expect(201);
    const tmpId = (disposable.body as { id: string }).id;
    await admin.delete(`/api/v1/employees/${tmpId}`).expect(204);
    await admin.get(`/api/v1/employees/${tmpId}`).expect(404);

    const audits: Array<{ before: { lastName?: string } }> = await ds.query(
      `SELECT before FROM audit_logs WHERE action = 'delete' AND entity_type = 'Employee' ORDER BY id DESC LIMIT 1`,
    );
    expect(audits[0].before.lastName).toBe('Person');
  });
});
