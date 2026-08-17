import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assignments, auditEvents, employees } from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const MAYA = { firstName: 'Maya', lastName: 'Lindqvist', email: 'Maya.Lindqvist@Acme.io' };

async function createEmployee(cookie: string, overrides: Record<string, unknown> = {}) {
  return inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { ...MAYA, ...overrides },
  });
}

async function assignAsset(cookie: string, employeeId: string, name = 'MacBook Pro 14"') {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: {
      name,
      category: 'laptops',
      status: 'assigned',
      assignedToEmployeeId: employeeId,
      checkoutDate: '2026-01-09',
    },
  });
  if (res.statusCode !== 200) throw new Error(`asset create failed: ${res.body}`);
  return res.json().asset as { id: string };
}

describe('employee list', () => {
  it('needs a session', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/employees' });
    expect(res.statusCode).toBe(401);
  });

  it('counts what each person currently holds', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const maya = (await createEmployee(admin)).json().employee;
    await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor', email: 'd@acme.io' });
    await assignAsset(admin, maya.id);
    await assignAsset(admin, maya.id, 'Dell U2723QE');

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/employees',
      cookie: memberCookie(ctx.db, 'viewer'),
    });
    expect(res.statusCode).toBe(200);

    const list = res.json().employees as { email: string; activeAssetCount: number }[];
    expect(list.find((e) => e.email === 'maya.lindqvist@acme.io')!.activeAssetCount).toBe(2);
    expect(list.find((e) => e.email === 'd@acme.io')!.activeAssetCount).toBe(0);
  });
});

describe('creating an employee', () => {
  it('lowercases the email, starts them active, and audits it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await createEmployee(admin, { jobTitle: 'Product Designer', department: 'Design' });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee).toMatchObject({
      email: 'maya.lindqvist@acme.io',
      status: 'active',
      displayName: 'Maya Lindqvist',
      activeAssetCount: 0,
    });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'employee.created');
    expect(event).toMatchObject({ type: 'people' });
    expect(JSON.parse(event!.params)).toMatchObject({ employeeName: 'Maya Lindqvist' });
  });

  it('refuses a duplicate email with a field error, whatever the casing', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createEmployee(admin);

    const clash = await createEmployee(admin, { email: 'MAYA.LINDQVIST@acme.io' });
    expect(clash.statusCode).toBe(422);
    expect(clash.json().error.fields).toMatchObject({ email: expect.any(String) });
    expect(ctx.db.select().from(employees).all()).toHaveLength(1);
  });

  it('is closed to viewers and open to managers', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    expect((await createEmployee(memberCookie(ctx.db, 'viewer'))).statusCode).toBe(403);
    expect((await createEmployee(memberCookie(ctx.db, 'manager'))).statusCode).toBe(200);
  });
});

describe('editing an employee', () => {
  it('records the fields that changed', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
      body: { location: 'Stockholm', jobTitle: 'Staff Designer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee).toMatchObject({ location: 'Stockholm' });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'employee.updated');
    expect(JSON.parse(event!.params).changedFields.sort()).toEqual(['jobTitle', 'location']);
  });

  it('schedules returns for open assignments when offboarding starts', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;
    await assignAsset(admin, id);
    await assignAsset(admin, id, 'Dell U2723QE');

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
      body: { status: 'offboarding', returnDueDate: '2026-08-23' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee.status).toBe('offboarding');

    const open = ctx.db.select().from(assignments).where(eq(assignments.employeeId, id)).all();
    expect(open.map((a) => a.expectedReturnDate)).toEqual(['2026-08-23', '2026-08-23']);

    const event = ctx.db
      .select()
      .from(auditEvents)
      .all()
      .find((e) => e.action === 'employee.offboarding_started');
    expect(JSON.parse(event!.params)).toMatchObject({
      employeeName: 'Maya Lindqvist',
      scheduledReturns: 2,
      returnDueDate: '2026-08-23',
    });
  });

  it('leaves return dates alone when offboarding without a due date', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;
    await assignAsset(admin, id);

    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
      body: { status: 'offboarding' },
    });
    const open = ctx.db.select().from(assignments).where(eq(assignments.employeeId, id)).all();
    expect(open[0].expectedReturnDate).toBeNull();
  });

  it('refuses an email that another employee already uses', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createEmployee(admin);
    const other = (
      await createEmployee(admin, { firstName: 'Daniel', lastName: 'Okafor', email: 'd@acme.io' })
    ).json().employee;

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${other.id}`,
      cookie: admin,
      body: { email: 'maya.lindqvist@acme.io' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields).toMatchObject({ email: expect.any(String) });
  });
});

describe('deleting an employee', () => {
  it('is admin-only and audited', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;

    const manager = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/employees/${id}`,
      cookie: memberCookie(ctx.db, 'manager'),
    });
    expect(manager.statusCode).toBe(403);

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.db.select().from(employees).all()).toHaveLength(0);
    expect(
      ctx.db
        .select()
        .from(auditEvents)
        .all()
        .some((e) => e.action === 'employee.deleted'),
    ).toBe(true);
  });

  it('refuses while they still hold something', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;
    await assignAsset(admin, id);

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('employee_holds_assets');
  });

  it('keeps the name on past ownership records', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;
    const asset = await assignAsset(admin, id);

    // Close the assignment by hand — check-in arrives with the assignment PR.
    ctx.db
      .update(assignments)
      .set({ returnedAt: '2026-02-01' })
      .where(eq(assignments.assetId, asset.id))
      .run();

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);

    const history = ctx.db.select().from(assignments).all();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ employeeId: null, holderNameSnapshot: 'Maya Lindqvist' });
  });
});

describe('employee detail', () => {
  it('returns the person with their live asset count', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = (await createEmployee(admin)).json().employee.id;
    await assignAsset(admin, id);

    const res = await inject(ctx.app, {
      method: 'GET',
      url: `/api/v1/employees/${id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee).toMatchObject({
      displayName: 'Maya Lindqvist',
      activeAssetCount: 1,
    });
  });

  it('404s for an unknown id', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/employees/nope',
      cookie: admin,
    });
    expect(res.statusCode).toBe(404);
  });
});
