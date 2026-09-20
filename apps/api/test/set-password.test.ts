import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditEvents, members, sessions } from '@/db/schema.js';
import {
  buildTestApp,
  inject,
  memberCookie,
  SETUP_BODY,
  sessionCookie,
  setupOrg,
  type TestApp,
} from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const NEW_PASSWORD = 'Handed-over-pass1';

/** An active member with a real password, created through the invite flow. */
async function activeMember(cookie: string) {
  const invite = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/members/invites',
    cookie,
    body: { email: 'grace@acme.io', role: 'viewer' },
  });
  const token = new URL(invite.json().inviteUrl as string).searchParams.get('token')!;
  const joined = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/auth/accept-invite',
    body: { token, name: 'Grace Chen', password: 'Graces-first-pass1' },
  });
  const id = (await ctx.db.select().from(members).where(eq(members.email, 'grace@acme.io')))[0]!.id;
  return { id, cookie: sessionCookie(joined) };
}

function login(email: string, password: string) {
  return inject(ctx.app, { method: 'POST', url: '/api/v1/auth/login', body: { email, password } });
}

// The red test for the review's finding: a pending admin-issued reset link
// must die with the set, exactly as it dies with a self-service change —
// whoever holds it could otherwise take the account straight back.

describe('POST /api/v1/members/:id/password', () => {
  it('kills a pending reset link — the set password is the newer word', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const grace = await activeMember(admin);

    const link = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${grace.id}/reset-link`,
      cookie: admin,
    });
    const token = new URL(link.json().resetUrl as string).searchParams.get('token')!;

    await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${grace.id}/password`,
      cookie: admin,
      body: { newPassword: NEW_PASSWORD },
    });

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      body: { token, newPassword: 'Attacker-chosen-pass1' },
    });
    expect(res.statusCode).toBe(401);
    expect((await login('grace@acme.io', NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('sets the password, signs the member out everywhere, and audits it by name', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const grace = await activeMember(admin);

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${grace.id}/password`,
      cookie: admin,
      body: { newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(204);

    // Every session she had is gone — the credential changed under her.
    const me = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      cookie: grace.cookie,
    });
    expect(me.statusCode).toBe(401);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.memberId, grace.id))).toEqual([]);

    expect((await login('grace@acme.io', 'Graces-first-pass1')).statusCode).toBe(401);
    expect((await login('grace@acme.io', NEW_PASSWORD)).statusCode).toBe(200);

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.password_set'));
    expect(event?.type).toBe('auth');
    expect(JSON.parse(event!.params).memberName).toBe('Grace Chen');
  });

  it('refuses your own account: knowing the current password is that door', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: admin });

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${me.json().member.id as string}/password`,
      cookie: admin,
      body: { newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('self_password_set');
    expect((await login(SETUP_BODY.email, SETUP_BODY.password)).statusCode).toBe(200);
  });

  it('refuses an invited member — resend the invite instead', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const invite = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'pending@acme.io', role: 'viewer' },
    });
    const id = invite.json().member.id as string;

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${id}/password`,
      cookie: admin,
      body: { newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('not_active');
  });

  it('holds the new password to the shared rule, and the door to members.manage', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const grace = await activeMember(admin);

    const weak = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${grace.id}/password`,
      cookie: admin,
      body: { newPassword: 'weakpassword' },
    });
    expect(weak.statusCode).toBe(422);

    const viewer = await memberCookie(ctx.db, 'viewer');
    const forbidden = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${grace.id}/password`,
      cookie: viewer,
      body: { newPassword: NEW_PASSWORD },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
