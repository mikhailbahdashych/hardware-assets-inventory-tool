import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, assignments, auditEvents, employees } from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const ASSET_ROW = {
  asset_tag: 'AST-1000',
  name: 'MacBook Pro 14"',
  category: 'Laptops',
};

function post(url: string, cookie: string, body: Record<string, unknown>) {
  return inject(ctx.app, { method: 'POST', url: `/api/v1${url}`, cookie, body });
}

describe('the CSV templates', () => {
  it('are served as downloadable files a person can fill in', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/import/template?kind=assets',
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('filename="assets-template.csv"');
    expect(res.body.split('\n')[0]).toBe(
      'asset_tag,name,category,serial_number,status,assigned_to_email,purchase_date,purchase_price,currency,supplier,warranty_until,notes',
    );
  });

  it('refuses a kind that is not one of the two', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/import/template?kind=spaceships',
      cookie: admin,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('the dry run', () => {
  it('needs a role that may import', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await post('/import/validate', await memberCookie(ctx.db, 'viewer'), {
      kind: 'assets',
      rows: [ASSET_ROW],
    });
    expect(res.statusCode).toBe(403);
  });

  it('reports what would happen without writing a thing', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await post('/import/validate', admin, {
      kind: 'assets',
      rows: [ASSET_ROW, { ...ASSET_ROW, asset_tag: 'AST-1001', category: 'Hovercraft' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().report).toMatchObject({
      totalRows: 2,
      validCount: 1,
      createCount: 1,
      updateCount: 0,
    });
    expect(res.json().report.errors[0]).toMatchObject({ row: 3, column: 'category' });

    expect(await ctx.db.select().from(assets).all()).toEqual([]);
    expect(
      await ctx.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'system.import_completed'))
        .all(),
    ).toEqual([]);
  });

  it('knows what the inventory already holds', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await post('/assets', admin, {
      name: 'Existing',
      category: 'laptops',
      status: 'available',
      assetTag: 'AST-1000',
    });

    const res = await post('/import/validate', admin, { kind: 'assets', rows: [ASSET_ROW] });
    expect(res.json().report.errors[0].message).toMatch(/already exists/i);
  });
});

describe('committing an asset import', () => {
  it('writes every valid row and audits the import once', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await post('/import/commit', admin, {
      kind: 'assets',
      rows: [
        { ...ASSET_ROW, purchase_price: '2,340.00', warranty_until: '2027-03-12' },
        { ...ASSET_ROW, asset_tag: 'AST-1001', name: 'Dell U2723QE', category: 'Monitors' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'assets', created: 2, updated: 0 });

    const rows = await ctx.db.select().from(assets).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.assetTag === 'AST-1000')).toMatchObject({
      name: 'MacBook Pro 14"',
      category: 'laptops',
      status: 'available',
      purchasePriceCents: 234000,
      warrantyUntil: '2027-03-12',
    });

    // One event for the import, not one per row — the log stays readable.
    const events = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'system.import_completed'))
      .all();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.params)).toEqual({ kind: 'assets', created: 2, updated: 0 });
  });

  it('opens an ownership record for a row that arrives already assigned', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const maya = (
      await post('/employees', admin, {
        firstName: 'Maya',
        lastName: 'Lindqvist',
        email: 'maya.lindqvist@acme.io',
      })
    ).json().employee;

    await post('/import/commit', admin, {
      kind: 'assets',
      rows: [
        {
          ...ASSET_ROW,
          status: 'Assigned',
          assigned_to_email: 'Maya.Lindqvist@Acme.io',
          purchase_date: '2023-03-12',
        },
      ],
    });

    const asset = (await ctx.db.select().from(assets).get())!;
    expect(asset.status).toBe('assigned');

    // The invariant holds: assigned ⇔ exactly one open ownership row.
    const open = await ctx.db.select().from(assignments).all();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      assetId: asset.id,
      employeeId: maya.id,
      holderNameSnapshot: 'Maya Lindqvist',
      returnedAt: null,
      checkoutNotes: 'Imported via CSV',
    });
  });

  it('refuses the whole file when any row is wrong', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await post('/import/commit', admin, {
      kind: 'assets',
      rows: [ASSET_ROW, { ...ASSET_ROW, asset_tag: 'AST-1001', name: '' }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('import_invalid');
    expect(res.json().error.message).toMatch(/1 row/);
    // Nothing at all: a half-imported file is worse than a rejected one.
    expect(await ctx.db.select().from(assets).all()).toEqual([]);
  });

  it('cannot be used to skip the dry run', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    // No /import/validate call at all — commit re-runs the same planner.
    const res = await post('/import/commit', admin, {
      kind: 'assets',
      rows: [{ ...ASSET_ROW, category: 'Hovercraft' }],
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('committing an employee import', () => {
  it('creates the new people and updates the ones it recognizes', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await post('/employees', admin, {
      firstName: 'Maya',
      lastName: 'Lindqvist',
      email: 'maya.lindqvist@acme.io',
      department: 'Design',
    });

    const res = await post('/import/commit', admin, {
      kind: 'employees',
      rows: [
        {
          first_name: 'Maya',
          last_name: 'Lindqvist',
          email: 'maya.lindqvist@acme.io',
          department: 'Engineering',
          location: 'Stockholm',
        },
        { first_name: 'Daniel', last_name: 'Okafor', email: 'daniel.okafor@acme.io' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'employees', created: 1, updated: 1 });

    const rows = await ctx.db.select().from(employees).all();
    expect(rows).toHaveLength(2);
    const maya = rows.find((row) => row.email === 'maya.lindqvist@acme.io')!;
    expect(maya.department).toBe('Engineering');
    expect(maya.location).toBe('Stockholm');
    // An update never resurrects somebody who is on their way out.
    expect(maya.status).toBe('active');
  });

  it('keeps the person a member is linked to, rather than replacing the row', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const maya = (
      await post('/employees', admin, {
        firstName: 'Maya',
        lastName: 'Lindqvist',
        email: 'maya.lindqvist@acme.io',
      })
    ).json().employee;

    await post('/import/commit', admin, {
      kind: 'employees',
      rows: [{ first_name: 'Maja', last_name: 'Lindqvist', email: 'maya.lindqvist@acme.io' }],
    });

    const rows = await ctx.db.select().from(employees).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(maya.id);
    expect(rows[0]!.firstName).toBe('Maja');
  });
});
