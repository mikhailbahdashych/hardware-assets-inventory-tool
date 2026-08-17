import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, inject, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const SMTP = { SMTP_HOST: 'smtp.acme.io' };

async function createEmployee(cookie: string, body: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io', ...body },
  });
  return res.json().employee as { id: string };
}

async function createAsset(cookie: string, body: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available', ...body },
  });
  return res.json().asset as { id: string };
}

describe('/meta', () => {
  it('says whether this instance can send email at all', async () => {
    ctx = await buildTestApp();
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' })).json().smtpConfigured,
    ).toBe(false);
    await ctx.close();

    ctx = await buildTestApp(SMTP);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' })).json().smtpConfigured,
    ).toBe(true);
  });
});

describe('inviting somebody', () => {
  it('emails the link when asked, and still returns it', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'grace@acme.io', role: 'manager', sendEmail: true },
    });
    expect(res.statusCode).toBe(200);

    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].to).toBe('grace@acme.io');
    expect(ctx.sent[0].subject).toBe('Join Acme Corp on Inventory');
    expect(ctx.sent[0].text).toContain('as a Manager');
    // The same link either way: email is the convenience, not the contract.
    expect(ctx.sent[0].text).toContain(res.json().inviteUrl);
  });

  it('sends nothing when the box was unticked', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'grace@acme.io', role: 'viewer', sendEmail: false },
    });
    expect(ctx.sent).toEqual([]);
  });

  it('sends nothing when the workspace switched invite emails off', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { emailInvites: false },
    });

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'grace@acme.io', role: 'viewer', sendEmail: true },
    });
    // The invitation still exists; only the message did not go.
    expect(res.statusCode).toBe(200);
    expect(res.json().inviteUrl).toContain('/accept-invite?token=');
    expect(ctx.sent).toEqual([]);
  });

  it('still works with no SMTP at all — the link is the delivery', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'grace@acme.io', role: 'viewer', sendEmail: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inviteUrl).toContain('/accept-invite?token=');
    expect(ctx.sent).toEqual([]);
  });

  it('resending mails the fresh link too', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    const { member } = (
      await inject(ctx.app, {
        method: 'POST',
        url: '/api/v1/members/invites',
        cookie: admin,
        body: { email: 'grace@acme.io', role: 'viewer', sendEmail: false },
      })
    ).json();

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${member.id}/resend-invite`,
      cookie: admin,
    });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].text).toContain(res.json().inviteUrl);
  });
});

describe('a reset link an admin issues', () => {
  it('goes to the member as well as back to the admin', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    const me = ctx.db
      .select()
      .from((await import('@/db/schema.js')).members)
      .get()!;

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${me.id}/reset-link`,
      cookie: admin,
    });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].to).toBe('tomasz@acme.io');
    expect(ctx.sent[0].text).toContain(res.json().resetUrl);
  });
});

describe('handing an asset over', () => {
  it('tells the assignee when the box is ticked, and not otherwise', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    const maya = await createEmployee(admin);
    const quiet = await createAsset(admin, { name: 'Quiet one' });
    const loud = await createAsset(admin, { name: 'MacBook Pro 14"' });

    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${quiet.id}/assign`,
      cookie: admin,
      body: { employeeId: maya.id, checkoutDate: '2026-03-14' },
    });
    expect(ctx.sent).toEqual([]);

    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${loud.id}/assign`,
      cookie: admin,
      body: {
        employeeId: maya.id,
        checkoutDate: '2026-03-14',
        expectedReturnDate: '2026-09-01',
        notify: true,
      },
    });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].to).toBe('maya@acme.io');
    expect(ctx.sent[0].subject).toBe('MacBook Pro 14" is assigned to you');
    expect(ctx.sent[0].text).toContain('due back on 2026-09-01');
  });

  it('confirms a check-in to whoever was holding it', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    const maya = await createEmployee(admin);
    const asset = await createAsset(admin, {
      status: 'assigned',
      assignedToEmployeeId: maya.id,
      checkoutDate: '2026-03-14',
    });

    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${asset.id}/checkin`,
      cookie: admin,
      body: { returnDate: '2026-07-01', newStatus: 'available', emailConfirmation: true },
    });

    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].to).toBe('maya@acme.io');
    expect(ctx.sent[0].text).toContain('checked back in at Acme Corp on 2026-07-01');
  });

  it('does not fail the assignment when the relay is down', async () => {
    ctx = await buildTestApp(SMTP);
    const admin = await setupOrg(ctx.app);
    const maya = await createEmployee(admin);
    const asset = await createAsset(admin);
    // The mailer this instance has now refuses everything.
    ctx.deps.mailer!.send = async () => {
      throw new Error('connection refused');
    };

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/assets/${asset.id}/assign`,
      cookie: admin,
      body: { employeeId: maya.id, checkoutDate: '2026-03-14', notify: true },
    });
    // The device really did change hands; the email is the part that failed.
    expect(res.statusCode).toBe(200);
    expect(res.json().asset.status).toBe('assigned');
  });
});
