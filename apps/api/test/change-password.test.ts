import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditEvents } from '@/db/schema.js';
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

const NEW_PASSWORD = 'A-brand-new-password1';

function login(password: string) {
  return inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/auth/login',
    body: { email: SETUP_BODY.email, password },
  });
}

function changePassword(cookie: string | undefined, body: Record<string, string>) {
  return inject(ctx.app, { method: 'POST', url: '/api/v1/me/password', cookie, body });
}

describe('POST /api/v1/me/password', () => {
  it('changes the password, keeps this session, revokes every other one, and audits it', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    // A second signed-in browser, which the change must sign out.
    const otherCookie = sessionCookie(await login(SETUP_BODY.password));

    const res = await changePassword(cookie, {
      currentPassword: SETUP_BODY.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(204);

    // The session that made the change survives; the other one is gone.
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode,
    ).toBe(200);
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: otherCookie }))
        .statusCode,
    ).toBe(401);

    // The old password is dead, the new one signs in.
    expect((await login(SETUP_BODY.password)).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);

    const rows = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'auth.password_changed'));
    expect(rows).toHaveLength(1);
  });

  it('refuses a wrong current password with a field error, changing nothing', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const otherCookie = sessionCookie(await login(SETUP_BODY.password));

    const res = await changePassword(cookie, {
      currentPassword: 'not-the-password-at-all',
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields?.currentPassword).toBeDefined();

    // Nothing moved: the old password still signs in, the other session lives.
    expect((await login(SETUP_BODY.password)).statusCode).toBe(200);
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: otherCookie }))
        .statusCode,
    ).toBe(200);
    const rows = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'auth.password_changed'));
    expect(rows).toHaveLength(0);
  });

  it('kills a pending admin-issued reset link, which must not outlive the change', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    const id = me.json().member.id as string;
    const link = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${id}/reset-link`,
      cookie,
    });
    const token = new URL(link.json().resetUrl as string).searchParams.get('token')!;

    await changePassword(cookie, {
      currentPassword: SETUP_BODY.password,
      newPassword: NEW_PASSWORD,
    });

    // Whoever holds the old link must not be able to take the account back.
    const reset = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      body: { token, newPassword: 'Attacker-chosen-pass1' },
    });
    expect(reset.statusCode).toBe(401);
    expect((await login('Attacker-chosen-pass1')).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('rates guesses per member, not per office address', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    // Ten wrong guesses exhaust this member's own bucket…
    for (let index = 0; index < 10; index += 1) {
      await changePassword(cookie, {
        currentPassword: `wrong-guess-${index}`,
        newPassword: NEW_PASSWORD,
      });
    }
    const eleventh = await changePassword(cookie, {
      currentPassword: 'wrong-guess-10',
      newPassword: NEW_PASSWORD,
    });
    expect(eleventh.statusCode).toBe(429);

    // …and a colleague on the same address still gets an answer.
    const colleague = await memberCookie(ctx.db, 'viewer');
    const res = await changePassword(colleague, {
      currentPassword: 'anything-at-all',
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(422);
  });

  it('is for the signed-in only', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await changePassword(undefined, {
      currentPassword: SETUP_BODY.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(401);
  });

  it('holds the new password to the same rule as every other password field', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const res = await changePassword(cookie, {
      currentPassword: SETUP_BODY.password,
      newPassword: 'short',
    });
    expect(res.statusCode).toBe(422);
    // And the real password is untouched.
    expect((await login(SETUP_BODY.password)).statusCode).toBe(200);
  });
});
