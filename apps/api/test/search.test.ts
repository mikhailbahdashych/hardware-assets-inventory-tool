import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

// What the command palette asks: a few assets and a few people for one needle.
// Open to any authenticated member, like every other read.

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

async function createEmployee(cookie: string, body: Record<string, unknown>) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io', ...body },
  });
  if (res.statusCode !== 200) throw new Error(`employee create failed: ${res.body}`);
  return res.json().employee as { id: string };
}

describe('the palette search', () => {
  it('needs a session', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/search?q=mac' });
    expect(res.statusCode).toBe(401);
  });

  it('finds assets and people in one payload, open to a viewer', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, { name: 'MacBook Pro 14"', serialNumber: 'C02XK1AZQ6L7' });
    await createAsset(admin, { name: 'Dell U2723QE', category: 'monitors' });
    await createEmployee(admin, { department: 'Design', jobTitle: 'Product Designer' });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/search?q=ma',
      cookie: await memberCookie(ctx.db, 'viewer'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().assets.map((asset: { name: string }) => asset.name)).toEqual([
      'MacBook Pro 14"',
    ]);
    expect(
      res.json().employees.map((person: { displayName: string }) => person.displayName),
    ).toEqual(['Maya Lindqvist']);
  });

  it('answers an empty query with the newest few, which is what ⌘K opens on', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, { name: 'MacBook Pro 14"' });
    await createEmployee(admin, {});

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/search?q=', cookie: admin });
    expect(res.json().assets).toHaveLength(1);
    expect(res.json().employees).toHaveLength(1);
  });

  it('caps each group at what the palette draws', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    for (let index = 0; index < 9; index += 1) {
      await createAsset(admin, { name: `Spare laptop ${index}` });
      await createEmployee(admin, {
        firstName: 'Spare',
        lastName: `Person ${index}`,
        email: `spare${index}@acme.io`,
      });
    }

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/search?q=spare',
      cookie: admin,
    });
    expect(res.json().assets).toHaveLength(4);
    expect(res.json().employees).toHaveLength(4);
  });

  it('matches the same fields the lists do, and sends nothing sensitive', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, {
      name: 'MacBook Pro 14"',
      serialNumber: 'C02XK1AZQ6L7',
      purchasePriceCents: 234000,
      notes: 'bought with the company card',
    });
    await createEmployee(admin, { department: 'Design' });

    const bySerial = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/search?q=c02xk1',
      cookie: admin,
    });
    expect(bySerial.json().assets).toHaveLength(1);
    expect(bySerial.json().assets[0]).toEqual({
      id: expect.any(String),
      name: 'MacBook Pro 14"',
      assetTag: 'AST-0001',
      category: 'laptops',
      status: 'available',
    });

    const byEmail = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/search?q=maya@acme.io',
      cookie: admin,
    });
    expect(byEmail.json().employees[0]).toEqual({
      id: expect.any(String),
      displayName: 'Maya Lindqvist',
      jobTitle: null,
      department: 'Design',
    });
  });
});
