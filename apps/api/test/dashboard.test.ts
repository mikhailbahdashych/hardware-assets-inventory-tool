import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const NOW = new Date('2026-08-17T09:00:00.000Z');

async function createAsset(cookie: string, body: Record<string, unknown>) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { category: 'laptops', status: 'available', ...body },
  });
  if (res.statusCode !== 200) throw new Error(`asset create failed: ${res.body}`);
  return res.json().asset as { id: string };
}

async function createEmployee(cookie: string, body: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io', ...body },
  });
  if (res.statusCode !== 200) throw new Error(`employee create failed: ${res.body}`);
  return res.json().employee as { id: string };
}

describe('the dashboard payload', () => {
  it('needs a session, and every role may read it', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/dashboard' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await inject(ctx.app, {
          method: 'GET',
          url: '/api/v1/dashboard',
          cookie: await memberCookie(ctx.db, 'viewer'),
        })
      ).statusCode,
    ).toBe(200);
  });

  it('counts every status and every category, zeros included', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, { name: 'MacBook Pro 14"' });
    await createAsset(admin, { name: 'ThinkPad X1', status: 'in_repair' });
    await createAsset(admin, { name: 'Dell U2723QE', category: 'monitors' });

    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();

    expect(body.assetCount).toBe(3);
    // One tile per status the workspace has, in its own order, carrying the
    // label and colour the tile renders in — the web needs no vocabulary of
    // its own to draw them.
    expect(body.statusCounts).toEqual([
      { id: 'available', label: 'Available', color: 'ok', count: 2 },
      { id: 'assigned', label: 'Assigned', color: 'acc', count: 0 },
      { id: 'in_repair', label: 'In repair', color: 'warn', count: 1 },
      { id: 'ordered', label: 'Ordered', color: 'info', count: 0 },
      { id: 'retired', label: 'Retired', color: 'neut', count: 0 },
      { id: 'lost_stolen', label: 'Lost/Stolen', color: 'err', count: 0 },
    ]);
    expect(body.categoryCounts).toEqual([
      { category: 'laptops', count: 2 },
      { category: 'desktops', count: 0 },
      { category: 'monitors', count: 1 },
      { category: 'phones', count: 0 },
      { category: 'peripherals', count: 0 },
    ]);
  });

  it('gives a status the admin invented a tile of its own', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/workflow/statuses',
      cookie: admin,
      body: { label: 'On loan', color: 'info' },
    });
    await createAsset(admin, { name: 'ThinkPad X1', status: 'on_loan' });

    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();

    expect(body.assetCount).toBe(1);
    expect(body.statusCounts).toHaveLength(7);
    // Last, because a new status lands last — the tiles follow the sort order.
    expect(body.statusCounts.at(-1)).toEqual({
      id: 'on_loan',
      label: 'On loan',
      color: 'info',
      count: 1,
    });
  });

  it('shows the newest activity as the log would render it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, { name: 'MacBook Pro 14"' });

    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();

    expect(body.recentActivity[0]).toMatchObject({
      action: 'asset.created',
      type: 'assets',
      actorName: 'Tomasz Kowalski',
      params: { assetName: 'MacBook Pro 14"' },
    });
    expect(body.recentActivity.length).toBeLessThanOrEqual(8);
  });

  it('lists warranties running out inside 90 days, soonest first', async () => {
    ctx = await buildTestApp({}, () => NOW);
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, { name: 'Expired already', warrantyUntil: '2026-07-01' });
    await createAsset(admin, { name: 'Due in 26 days', warrantyUntil: '2026-09-12' });
    await createAsset(admin, { name: 'Due in 61 days', warrantyUntil: '2026-10-17' });
    await createAsset(admin, { name: 'Far away', warrantyUntil: '2027-03-12' });
    await createAsset(admin, { name: 'No warranty' });

    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();

    // Expired ones drop off: the alert for those has already been and gone.
    expect(body.warrantyExpirations.map((row: { name: string }) => row.name)).toEqual([
      'Due in 26 days',
      'Due in 61 days',
    ]);
    expect(body.warrantyExpirations[0]).toMatchObject({
      daysLeft: 26,
      warrantyUntil: '2026-09-12',
    });
    expect(body.warrantyExpirations[1].daysLeft).toBe(61);
  });

  it('lists what is due back, soonest first, with who has it', async () => {
    ctx = await buildTestApp({}, () => NOW);
    const admin = await setupOrg(ctx.app);
    const maya = await createEmployee(admin);
    const asset = await createAsset(admin, {
      name: 'MacBook Pro 14"',
      status: 'assigned',
      assignedToEmployeeId: maya.id,
      checkoutDate: '2026-01-09',
    });

    // A plain assignment is not pending anything; offboarding sets the date.
    let body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();
    expect(body.pendingReturns).toEqual([]);

    await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/employees/${maya.id}`,
      cookie: admin,
      body: { status: 'offboarding', returnDueDate: '2026-08-24' },
    });

    body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();
    expect(body.pendingReturns).toEqual([
      {
        assetId: asset.id,
        assetName: 'MacBook Pro 14"',
        assetTag: 'AST-0001',
        employeeId: maya.id,
        holderName: 'Maya Lindqvist',
        expectedReturnDate: '2026-08-24',
      },
    ]);
  });

  it('describes an empty instance without pretending it has anything', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const body = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/dashboard', cookie: admin })
    ).json();

    expect(body.assetCount).toBe(0);
    expect(body.statusCounts.map((tile: { count: number }) => tile.count)).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(body.warrantyExpirations).toEqual([]);
    expect(body.pendingReturns).toEqual([]);
    // Setting the workspace up is itself the first thing that happened.
    expect(body.recentActivity).toHaveLength(1);
  });
});
