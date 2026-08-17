import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { members, mfaRecoveryCodes, orgSettings } from '@/db/schema.js';
import { totpCode } from '@/lib/totp.js';
import { buildTestApp, inject, sessionCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const ADMIN = { email: 'tomasz@acme.io', password: 'correct-horse-battery' };

/** The secret the app generated for a member, read straight from the column. */
function storedSecret(email: string): string {
  const row = ctx.db.select().from(members).where(eq(members.email, email)).get();
  if (!row?.mfaSecret) throw new Error(`${email} has no secret`);
  return row.mfaSecret;
}

async function enrol(cookie: string, email: string) {
  const started = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/me/mfa/enroll',
    cookie,
  });
  expect(started.statusCode).toBe(200);

  const confirmed = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/me/mfa/confirm',
    cookie,
    body: { code: totpCode(storedSecret(email), new Date()) },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return { enrolment: started.json(), recoveryCodes: confirmed.json().recoveryCodes as string[] };
}

async function login(body: Record<string, unknown>) {
  return inject(ctx.app, { method: 'POST', url: '/api/v1/auth/login', body });
}

describe('enrolling an authenticator', () => {
  it('hands back something to scan and something to type', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    const res = await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie });
    const body = res.json();

    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(body.otpauthUri);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(body.secret);
    expect(uri.searchParams.get('issuer')).toBe('Acme Corp');
  });

  it('is not enrolled until a live code proves the app really has the secret', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie });

    // A secret exists, but abandoning here must leave nothing to be locked by.
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(me.json().member.mfaEnrolled).toBe(false);

    const wrong = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/me/mfa/confirm',
      cookie,
      body: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.code).toBe('mfa_code_invalid');
  });

  it('issues ten single-use recovery codes, once', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { recoveryCodes } = await enrol(cookie, ADMIN.email);

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);

    // Stored hashed, like every other token in this app.
    const stored = ctx.db.select().from(mfaRecoveryCodes).all();
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(recoveryCodes).not.toContain(row.codeHash);
      expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('refuses a second enrolment on an account that already has one', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);

    const again = await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('mfa_already_enrolled');
  });
});

describe('signing in with a second factor', () => {
  it('stops at the password and asks for a code', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);

    const res = await login(ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json().mfaRequired).toBe(true);
    expect(res.json().challengeToken).toBeTruthy();
    // The password alone must not have produced a session.
    expect(res.cookies.find((c) => c.name === 'inv_session')).toBeUndefined();
    expect(res.json().member).toBeUndefined();
  });

  it('completes the login with an authenticator code', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const { challengeToken } = (await login(ADMIN)).json();

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken, code: totpCode(storedSecret(ADMIN.email), new Date()) },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().member.email).toBe(ADMIN.email);
    const session = sessionCookie(res);
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: session });
    expect(me.statusCode).toBe(200);
  });

  it('completes it with a recovery code, and spends that code', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { recoveryCodes } = await enrol(cookie, ADMIN.email);
    const code = recoveryCodes[0]!;

    const first = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: (await login(ADMIN)).json().challengeToken, code },
    });
    expect(first.statusCode, first.body).toBe(200);

    // Single use: the same code must not work twice.
    const second = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: (await login(ADMIN)).json().challengeToken, code },
    });
    expect(second.statusCode).toBe(422);

    const spent = ctx.db
      .select()
      .from(mfaRecoveryCodes)
      .all()
      .filter((row) => row.usedAt);
    expect(spent).toHaveLength(1);
  });

  it('refuses a wrong code, a stale challenge and a made-up one', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const { challengeToken } = (await login(ADMIN)).json();

    const wrong = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken, code: '000000' },
    });
    expect(wrong.statusCode).toBe(422);

    // A challenge that does not exist is not "bad request" — it is not signed
    // in, which is the same answer an expired one gets.
    const forged = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: 'not-a-real-token', code: '000000' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('will not reuse a challenge token after it has worked', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const { challengeToken } = (await login(ADMIN)).json();
    const code = () => totpCode(storedSecret(ADMIN.email), new Date());

    expect(
      (
        await inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          body: { challengeToken, code: code() },
        })
      ).statusCode,
    ).toBe(200);

    const replay = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken, code: code() },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe('when the workspace requires it', () => {
  async function requireMfa(cookie: string) {
    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie,
      body: { mfaRequired: true },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  it('locks an un-enrolled member out of everything but setting up', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await requireMfa(cookie);

    const blocked = await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('mfa_enrolment_required');

    // …but the way out is open, and so is finding out where you stand.
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode,
    ).toBe(200);
    expect(
      (await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie })).statusCode,
    ).toBe(200);
  });

  it('reaches somebody already signed in, on their next request', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie })).statusCode,
    ).toBe(200);

    await requireMfa(cookie);
    // Same session, no re-login: the requirement is read per request.
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie })).statusCode,
    ).toBe(409);
  });

  it('locks the mutating and admin routes too, not only the read-only ones', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await requireMfa(cookie);

    // `requireAuth` guards the list endpoints; `requireAction` guards every
    // write and every admin surface. A gate that only covers the first is not
    // a gate — a password-only session could still change the whole workspace,
    // including switching the requirement back off and wiping everybody's
    // authenticator on the way.
    const blocked: [string, string, Record<string, unknown> | undefined][] = [
      ['POST', '/api/v1/assets', { name: 'Sneaky', category: 'laptops', status: 'available' }],
      ['POST', '/api/v1/employees', { firstName: 'A', lastName: 'B', email: 'a.b@acme.io' }],
      ['GET', '/api/v1/audit', undefined],
      ['GET', '/api/v1/export', undefined],
      ['GET', '/api/v1/settings', undefined],
      ['PATCH', '/api/v1/settings', { mfaRequired: false }],
      ['POST', '/api/v1/members/invites', { email: 'x@acme.io', role: 'admin', sendEmail: false }],
      ['GET', '/api/v1/assets/next-tag', undefined],
    ];

    for (const [method, url, body] of blocked) {
      const res = await inject(ctx.app, { method: method as 'GET', url, cookie, body });
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(res.json().error.code, `${method} ${url}`).toBe('mfa_enrolment_required');
    }

    // The one that matters most: the requirement is still on, and every
    // enrolled member still has their authenticator.
    const settings = ctx.db.select().from(orgSettings).get();
    expect(settings?.mfaRequired).toBe(true);
  });

  it('lets them back in once they enrol', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await requireMfa(cookie);
    await enrol(cookie, ADMIN.email);

    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie })).statusCode,
    ).toBe(200);
  });
});

describe('admin control', () => {
  it('resets a member, sending them back through setup', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    const id = me.json().member.id;

    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${id}/mfa/reset`,
      cookie,
    });
    expect(res.statusCode).toBe(204);

    const row = ctx.db.select().from(members).where(eq(members.id, id)).get()!;
    expect(row.mfaSecret).toBeNull();
    expect(row.mfaConfirmedAt).toBeNull();
    expect(ctx.db.select().from(mfaRecoveryCodes).all()).toHaveLength(0);

    // And the password alone signs in again, because there is no second factor.
    expect((await login(ADMIN)).json().member.email).toBe(ADMIN.email);
  });

  it('wipes every secret and code when the requirement is switched off', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie,
      body: { mfaRequired: true },
    });
    await enrol(cookie, ADMIN.email);
    expect(ctx.db.select().from(mfaRecoveryCodes).all().length).toBeGreaterThan(0);

    const off = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie,
      body: { mfaRequired: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().settings.mfaRequired).toBe(false);

    expect(ctx.db.select().from(mfaRecoveryCodes).all()).toHaveLength(0);
    for (const row of ctx.db.select().from(members).all()) {
      expect(row.mfaSecret, row.email).toBeNull();
      expect(row.mfaConfirmedAt, row.email).toBeNull();
    }
    // Nobody is challenged any more.
    expect((await login(ADMIN)).json().mfaRequired).toBeUndefined();
  });

  it('is admin-only — a viewer cannot reset anybody, including themselves', async () => {
    ctx = await buildTestApp();
    const adminCookie = await setupOrg(ctx.app);
    const me = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      cookie: adminCookie,
    });
    const adminId = me.json().member.id;

    const viewer = await import('./helpers.js').then((h) => h.memberCookie(ctx.db, 'viewer'));
    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${adminId}/mfa/reset`,
      cookie: viewer,
    });
    expect(res.statusCode).toBe(403);
  });

  it('records both halves in the activity log', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const id = (await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).json()
      .member.id;
    await inject(ctx.app, { method: 'POST', url: `/api/v1/members/${id}/mfa/reset`, cookie });

    // Resetting a second factor ends that account's sessions — including your
    // own, when you are the account. Password alone gets back in, because the
    // authenticator is gone.
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie })).statusCode,
    ).toBe(401);
    const back = await login(ADMIN);
    const fresh = sessionCookie(back);

    const log = await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie: fresh });
    const actions = log.json().items.map((item: { action: string }) => item.action);
    expect(actions).toContain('member.mfa_enrolled');
    expect(actions).toContain('member.mfa_reset');
  });
});

describe('what the log must never contain', () => {
  it('keeps the secret and the recovery codes out of the member list', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { enrolment, recoveryCodes } = await enrol(cookie, ADMIN.email);

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/members', cookie });
    expect(res.body).not.toContain(enrolment.secret);
    for (const code of recoveryCodes) expect(res.body).not.toContain(code);
    // What it does say is whether they are covered.
    expect(res.json().members[0].mfaEnrolled).toBe(true);
  });
});
