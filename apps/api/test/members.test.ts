import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditEvents, authTokens, members, sessions } from '@/db/schema.js';
import { hashToken } from '@/lib/tokens.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

async function invite(cookie: string, body: Record<string, unknown> = {}) {
  return inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/members/invites',
    cookie,
    body: { email: 'grace@acme.io', role: 'manager', ...body },
  });
}

async function createEmployee(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/employees',
    cookie,
    body: { firstName: 'Grace', lastName: 'Chen', email: 'grace.chen@acme.io', ...overrides },
  });
  if (res.statusCode !== 200) throw new Error(`employee create failed: ${res.body}`);
  return res.json().employee as { id: string; displayName: string };
}

describe('the member list', () => {
  it('needs a session, and is readable by every role', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/members' })).statusCode).toBe(401);

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/members',
      cookie: memberCookie(ctx.db, 'viewer'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('names the linked employee rather than making the page fetch them', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    await invite(admin, { employeeId: employee.id });

    const list = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/members', cookie: admin })
    ).json().members as {
      email: string;
      linkedEmployee: { id: string; displayName: string } | null;
    }[];

    expect(list.find((m) => m.email === 'tomasz@acme.io')!.linkedEmployee).toBeNull();
    expect(list.find((m) => m.email === 'grace@acme.io')!.linkedEmployee).toEqual({
      id: employee.id,
      displayName: 'Grace Chen',
    });
  });

  it('never sends a password hash', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const body = (await inject(ctx.app, { method: 'GET', url: '/api/v1/members', cookie: admin }))
      .body;
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$argon2');
  });
});

describe('inviting a member', () => {
  it('is admin-only', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    expect((await invite(memberCookie(ctx.db, 'manager'))).statusCode).toBe(403);
    expect((await invite(memberCookie(ctx.db, 'viewer'))).statusCode).toBe(403);
  });

  it('creates an invited member and hands back a usable link', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await invite(admin, { email: 'Grace@Acme.io' });
    expect(res.statusCode).toBe(200);
    const { member, inviteUrl } = res.json() as {
      member: { id: string; email: string; role: string; status: string };
      inviteUrl: string;
    };
    expect(member).toMatchObject({ email: 'grace@acme.io', role: 'manager', status: 'invited' });

    // The link is what an admin copies when SMTP is not configured, so it must
    // work on its own — the token in it is the one the invite endpoint accepts.
    const token = new URL(inviteUrl).searchParams.get('token')!;
    const preview = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/invite/${encodeURIComponent(token)}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ email: 'grace@acme.io', role: 'manager' });

    const stored = ctx.db
      .select()
      .from(authTokens)
      .where(eq(authTokens.id, hashToken(token)))
      .get();
    expect(stored?.purpose).toBe('invite');
  });

  it('cannot sign in before the invite is accepted', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await invite(admin);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'grace@acme.io', password: 'anything-at-all' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('audits the invitation with the role it granted', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await invite(admin, { role: 'viewer' });

    const event = ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.invited'))
      .get();
    expect(event?.type).toBe('auth');
    expect(JSON.parse(event!.params)).toMatchObject({ email: 'grace@acme.io', role: 'viewer' });
  });

  it('refuses an email that already signs in here', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await invite(admin, { email: 'tomasz@acme.io' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.email).toMatch(/already/i);
  });

  it('refuses to link an employee who does not exist', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await invite(admin, { employeeId: 'nobody' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields.employeeId).toBeTruthy();
  });

  it('borrows the linked employee name so the row is not blank until they join', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);

    const linked = (await invite(admin, { employeeId: employee.id })).json().member;
    expect(linked.displayName).toBe('Grace Chen');

    const unlinked = (await invite(admin, { email: 'jonas.weber@acme.io' })).json().member;
    expect(unlinked.displayName).toBe('jonas.weber');
  });
});

describe('resending an invitation', () => {
  it('issues a fresh link and retires the previous one', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const { member, inviteUrl } = (await invite(admin)).json();
    const first = new URL(inviteUrl).searchParams.get('token')!;

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${member.id}/resend-invite`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);
    const second = new URL(res.json().inviteUrl).searchParams.get('token')!;
    expect(second).not.toBe(first);

    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${first}` })).statusCode,
    ).toBe(401);
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${second}` })).statusCode,
    ).toBe(200);
  });

  it('refuses for a member who already joined', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const me = ctx.db.select().from(members).get()!;

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${me.id}/resend-invite`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('already_active');
  });
});

describe('issuing a password reset link', () => {
  it('is the recovery path when there is no SMTP, and it is admin-only', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const me = ctx.db.select().from(members).get()!;

    expect(
      (
        await inject(ctx.app, {
          method: 'POST',
          url: `/api/v1/members/${me.id}/reset-link`,
          cookie: memberCookie(ctx.db, 'manager'),
        })
      ).statusCode,
    ).toBe(403);

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${me.id}/reset-link`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);

    const token = new URL(res.json().resetUrl).searchParams.get('token')!;
    const used = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      body: { token, newPassword: 'a-brand-new-password' },
    });
    expect(used.statusCode).toBe(200);
  });

  it('refuses for someone who has not joined yet — that is what the invite is', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const { member } = (await invite(admin)).json();

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${member.id}/reset-link`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('not_active');
  });
});

describe('changing a member', () => {
  it('changes a role and audits both sides of the move', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const { member } = (await invite(admin)).json();

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${member.id}`,
      cookie: admin,
      body: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().member.role).toBe('admin');

    const event = ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.role_changed'))
      .get();
    expect(JSON.parse(event!.params)).toMatchObject({ from: 'manager', to: 'admin' });
  });

  it('links and unlinks an employee record', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const employee = await createEmployee(admin);
    const { member } = (await invite(admin)).json();

    const linked = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${member.id}`,
      cookie: admin,
      body: { employeeId: employee.id },
    });
    expect(linked.json().member.linkedEmployee.displayName).toBe('Grace Chen');

    const unlinked = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${member.id}`,
      cookie: admin,
      body: { employeeId: null },
    });
    expect(unlinked.json().member.linkedEmployee).toBeNull();

    const events = ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.link_changed'))
      .all();
    expect(events).toHaveLength(2);
  });

  it('refuses to change your own role, which is what keeps an admin in the room', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const me = ctx.db.select().from(members).get()!;

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${me.id}`,
      cookie: admin,
      body: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('self_role_change');
  });

  it('lets one admin demote another, because the one doing it stays', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const otherCookie = memberCookie(ctx.db, 'admin');
    const setupAdmin = ctx.db.select().from(members).where(eq(members.role, 'admin')).all()[0];

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${setupAdmin.id}`,
      cookie: otherCookie,
      body: { role: 'manager' },
    });
    expect(res.statusCode).toBe(200);

    const remaining = ctx.db.select().from(members).where(eq(members.role, 'admin')).all();
    expect(remaining).toHaveLength(1);
  });
});

describe('removing a member', () => {
  it('takes their sessions with them', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const victimCookie = memberCookie(ctx.db, 'manager');
    const victim = ctx.db.select().from(members).where(eq(members.role, 'manager')).get()!;

    const res = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/members/${victim.id}`,
      cookie: admin,
    });
    expect(res.statusCode).toBe(204);

    expect(ctx.db.select().from(sessions).where(eq(sessions.memberId, victim.id)).all()).toEqual(
      [],
    );
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie: victimCookie }))
        .statusCode,
    ).toBe(401);

    const event = ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.removed'))
      .get();
    expect(JSON.parse(event!.params).memberName).toBe(victim.displayName);
  });

  it('refuses to remove you, which is the same guard the last admin relies on', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const me = ctx.db.select().from(members).get()!;

    const self = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/members/${me.id}`,
      cookie: admin,
    });
    expect(self.statusCode).toBe(409);
    expect(self.json().error.code).toBe('self_delete');
    expect(ctx.db.select().from(members).all()).toHaveLength(1);
  });

  it('keeps the audit trail an ex-member wrote', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const managerCookie = memberCookie(ctx.db, 'manager');
    const manager = ctx.db.select().from(members).where(eq(members.role, 'manager')).get()!;

    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/assets',
      cookie: managerCookie,
      body: { name: 'MacBook Pro 14"', category: 'laptops', status: 'available' },
    });
    await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/members/${manager.id}`,
      cookie: admin,
    });

    const created = ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'asset.created'))
      .get();
    expect(created?.actorName).toBe(manager.displayName);
    expect(created?.actorMemberId).toBeNull();
  });
});
