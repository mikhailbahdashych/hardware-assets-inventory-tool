import { eq, ne } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { members, mfaRecoveryCodes, orgSettings, sessions } from '@/db/schema.js';
import { hashToken } from '@/lib/tokens.js';
import { totpCode } from '@/lib/totp.js';
import { consumeToken, findValidToken, issueAuthToken } from '@/services/auth-tokens.js';
import { verifyChallenge } from '@/services/mfa.js';
import {
  buildTestApp,
  inject,
  memberCookie,
  sessionCookie,
  setupOrg,
  type TestApp,
} from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

const ADMIN = { email: 'tomasz@acme.io', password: 'Correct-horse-battery1' };

/** The secret the app generated for a member, read straight from the column. */
async function storedSecret(email: string): Promise<string> {
  const [row] = await ctx.db.select().from(members).where(eq(members.email, email));
  if (!row?.mfaSecret) throw new Error(`${email} has no secret`);
  return row.mfaSecret;
}

/**
 * The code an authenticator shows next. The one it shows now was spent
 * confirming the enrolment a moment ago, and a code works once — so a test that
 * signs in straight after enrolling types the next one, as a person would after
 * waiting for it. One step ahead is inside the window wherever the clock is.
 */
async function nextCode(email: string): Promise<string> {
  return totpCode(await storedSecret(email), new Date(Date.now() + 30_000));
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
    body: { code: totpCode(await storedSecret(email), new Date()) },
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
    const stored = await ctx.db.select().from(mfaRecoveryCodes);
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(recoveryCodes).not.toContain(row.codeHash);
      expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('hands back the same pending secret when asked again, so a reload keeps the scanned code', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    const first = await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie });
    const again = await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());

    // The authenticator that scanned the first QR code confirms the enrolment.
    const confirmed = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/me/mfa/confirm',
      cookie,
      body: { code: totpCode(first.json().secret, new Date()) },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
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
      body: { challengeToken, code: await nextCode(ADMIN.email) },
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

    const spent = (await ctx.db.select().from(mfaRecoveryCodes)).filter((row) => row.usedAt);
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
    const code = () => nextCode(ADMIN.email);

    expect(
      (
        await inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          body: { challengeToken, code: await code() },
        })
      ).statusCode,
    ).toBe(200);

    const replay = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken, code: await code() },
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
      ['POST', '/api/v1/members/invites', { email: 'x@acme.io', role: 'admin' }],
      ['GET', '/api/v1/assets/next-tag', undefined],
    ];

    for (const [method, url, body] of blocked) {
      const res = await inject(ctx.app, { method: method as 'GET', url, cookie, body });
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(res.json().error.code, `${method} ${url}`).toBe('mfa_enrolment_required');
    }

    // The one that matters most: the requirement is still on, and every
    // enrolled member still has their authenticator.
    const [settings] = await ctx.db.select().from(orgSettings);
    expect(settings?.mfaRequired).toBe(true);
  });

  it('refuses to read a missing settings row as "not required"', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    // A session implies setup ran, so this is a broken instance — and reading
    // the requirement off a row that is not there would wave everybody past it.
    await ctx.db.delete(orgSettings);

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('not_initialized');
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

    const row = (await ctx.db.select().from(members).where(eq(members.id, id)))[0]!;
    expect(row.mfaSecret).toBeNull();
    expect(row.mfaConfirmedAt).toBeNull();
    expect(await ctx.db.select().from(mfaRecoveryCodes)).toHaveLength(0);

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
    expect((await ctx.db.select().from(mfaRecoveryCodes)).length).toBeGreaterThan(0);

    const off = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie,
      body: { mfaRequired: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().settings.mfaRequired).toBe(false);

    expect(await ctx.db.select().from(mfaRecoveryCodes)).toHaveLength(0);
    for (const row of await ctx.db.select().from(members)) {
      expect(row.mfaSecret, row.email).toBeNull();
      expect(row.mfaConfirmedAt, row.email).toBeNull();
    }
    // Nobody is challenged any more.
    expect((await login(ADMIN)).json().mfaRequired).toBeUndefined();
  });

  it('wipes nothing when a form resends an unchanged false beside another edit', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    // Enrolled by choice, with the workspace requirement off.
    await enrol(cookie, ADMIN.email);

    const save = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie,
      body: { orgName: 'Acme Holdings', mfaRequired: false },
    });
    expect(save.statusCode).toBe(200);

    const [row] = await ctx.db.select().from(members).where(eq(members.email, ADMIN.email));
    expect(row!.mfaConfirmedAt).not.toBeNull();
    expect((await ctx.db.select().from(mfaRecoveryCodes)).length).toBeGreaterThan(0);
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

describe('resetting somebody’s recovery codes', () => {
  /** The signed-in admin's own member id — the target of most of these. */
  async function myId(cookie: string): Promise<string> {
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    return me.json().member.id as string;
  }

  function resetCodes(cookie: string, id: string) {
    return inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${id}/mfa/reset-codes`,
      cookie,
    });
  }

  it('empties the set, and leaves the authenticator and the session alone', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const id = await myId(cookie);

    const res = await resetCodes(cookie, id);
    expect(res.statusCode, res.body).toBe(204);

    expect(await ctx.db.select().from(mfaRecoveryCodes)).toHaveLength(0);
    // Unlike the full reset, nothing here is un-protected: the authenticator
    // still stands, so the sessions it guards keep working.
    const row = (await ctx.db.select().from(members).where(eq(members.id, id)))[0]!;
    expect(row.mfaConfirmedAt).not.toBeNull();
    expect(row.mfaSecret).not.toBeNull();
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie })).statusCode,
    ).toBe(200);
  });

  it('is allowed on your own account, and says so in the log', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const id = await myId(cookie);
    expect((await resetCodes(cookie, id)).statusCode).toBe(204);

    const log = await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie });
    const entry = (log.json().items as { action: string; params: Record<string, unknown> }[]).find(
      (item) => item.action === 'member.mfa_codes_reset',
    );
    expect(entry).toBeDefined();
    // The name as it was, snapshotted — and nothing about the codes.
    expect(entry!.params).toEqual({ memberName: 'Tomasz Kowalski' });
  });

  it('refuses a target with no authenticator — there are no codes to reset', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const id = await myId(cookie);

    const res = await resetCodes(cookie, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('not_enrolled');
    expect(res.json().error.message).toContain('no authenticator');
  });

  it('404s on somebody who does not exist', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    expect((await resetCodes(cookie, 'nobody')).statusCode).toBe(404);
  });

  it('is admin-only — a viewer cannot reset anybody’s codes', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    const id = await myId(cookie);

    const viewer = await memberCookie(ctx.db, 'viewer');
    expect((await resetCodes(viewer, id)).statusCode).toBe(403);
    // And the refusal really refused: the codes are still there.
    expect(await ctx.db.select().from(mfaRecoveryCodes)).toHaveLength(10);
  });
});

describe('a sign-in that finds no codes left', () => {
  /** A full second-factor sign-in, ending in whatever the verify answered. */
  async function signIn(code: string) {
    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: (await login(ADMIN)).json().challengeToken, code },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res;
  }

  const totp = () => nextCode(ADMIN.email);

  /** Codes still in hand, straight off the table. */
  const unusedCount = async () =>
    (await ctx.db.select().from(mfaRecoveryCodes)).filter((row) => row.usedAt === null).length;

  /** Every code an admin's reset would leave behind: none. */
  async function resetCodes(cookie: string) {
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${me.json().member.id}/mfa/reset-codes`,
      cookie,
    });
    expect(res.statusCode).toBe(204);
  }

  it('hands over a fresh ten, stored hashed like the first ten were', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    await resetCodes(cookie);

    const codes = (await signIn(await totp())).json().recoveryCodes as string[];

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);

    // The response is the only place they exist in the clear: what the table
    // holds is their hashes, and nothing else is left over from the old set.
    const stored = await ctx.db.select().from(mfaRecoveryCodes);
    expect(stored.map((row) => row.codeHash).sort()).toEqual(codes.map(hashToken).sort());
    for (const row of stored) expect(row.usedAt).toBeNull();
  });

  it('says nothing about codes on an ordinary sign-in', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);

    // Nine still in hand, so nothing is reissued and the key is simply absent.
    expect((await signIn(await totp())).json().recoveryCodes).toBeUndefined();
  });

  it('reissues in the very response that spent the last code', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { recoveryCodes } = await enrol(cookie, ADMIN.email);
    const last = recoveryCodes[0]!;
    // Nine sign-ins' worth of spending, written straight in rather than
    // signed in for nine times over. Marked used rather than deleted, exactly
    // as verifying with one leaves them.
    await ctx.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: '2026-08-18T00:00:00.000Z' })
      .where(ne(mfaRecoveryCodes.codeHash, hashToken(last)));

    const codes = (await signIn(last)).json().recoveryCodes as string[];

    // Somebody who signs in on their last code must not be told "0 left" and
    // sent away — the answer arrives with the sign-in that needed it.
    expect(codes).toHaveLength(10);
    expect(codes).not.toContain(last);
  });

  it('issues codes that really work next time', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    await resetCodes(cookie);
    const codes = (await signIn(await totp())).json().recoveryCodes as string[];

    const again = await signIn(codes[0]!);
    expect(again.json().member.email).toBe(ADMIN.email);
    // Spent, not reissued: nine is not zero, so nothing was minted.
    expect(await unusedCount()).toBe(9);
    expect(again.json().recoveryCodes).toBeUndefined();
  });

  it('records the reissue in the log, under the member who signed in', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    await resetCodes(cookie);
    const session = sessionCookie(await signIn(await totp()));

    const log = await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie: session });
    const entry = (
      log.json().items as { action: string; actorName: string; params: Record<string, unknown> }[]
    ).find((item) => item.action === 'member.mfa_codes_regenerated');
    expect(entry).toBeDefined();
    expect(entry!.actorName).toBe('Tomasz Kowalski');
    // The fact, never the codes.
    expect(entry!.params).toEqual({ memberName: 'Tomasz Kowalski' });
  });
});

describe('what the members list says about two-factor', () => {
  /** The signed-in member's own row, which is the one these tests enrolled. */
  async function summary(cookie: string, email = ADMIN.email) {
    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/members', cookie });
    expect(res.statusCode, res.body).toBe(200);
    const listed = res.json().members as {
      email: string;
      mfaEnrolled: boolean;
      recoveryCodesLeft: number | null;
    }[];
    const found = listed.find((member) => member.email === email);
    if (!found) throw new Error(`${email} is not on the members list`);
    return found;
  }

  /** One sign-in that spends a recovery code, ending with a live session. */
  async function spend(code: string) {
    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: (await login(ADMIN)).json().challengeToken, code },
    });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res);
  }

  it('counts a fresh enrolment as all ten', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);

    expect(await summary(cookie)).toMatchObject({ mfaEnrolled: true, recoveryCodesLeft: 10 });
  });

  it('counts down as codes are spent', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { recoveryCodes } = await enrol(cookie, ADMIN.email);

    await spend(recoveryCodes[0]!);
    const latest = await spend(recoveryCodes[1]!);

    expect((await summary(latest)).recoveryCodesLeft).toBe(8);
  });

  it('says null for somebody with no authenticator — there is no set to count', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    expect(await summary(cookie)).toMatchObject({ mfaEnrolled: false, recoveryCodesLeft: null });
  });

  it('says zero — not null — for an enrolled member whose codes are gone', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    await ctx.db.delete(mfaRecoveryCodes);

    // The difference the column exists for: "none left" is a state to fix,
    // "no set at all" is somebody who never enrolled.
    expect(await summary(cookie)).toMatchObject({ mfaEnrolled: true, recoveryCodesLeft: 0 });
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

// RFC 6238 §5.2: a verifier must not accept the same code twice. A code is live
// for its own step and one either side — about ninety seconds — so without a
// record of what was accepted, a code read over a shoulder or out of a proxy
// log signs in again for as long as it lasts. The clock is pinned here so each
// test says exactly which step a code belongs to.
describe('a code works once — authenticator, recovery code or challenge', () => {
  const STEP_MS = 30_000;
  /** Five seconds into a step: nothing below straddles a boundary by accident. */
  let clock: Date;
  const tick = (steps = 1) => {
    clock = new Date(clock.getTime() + steps * STEP_MS);
  };
  /** The code for the step `offset` away from the pinned clock. */
  const codeAt = (secret: string, offset = 0) =>
    totpCode(secret, new Date(clock.getTime() + offset * STEP_MS));
  /** The step the pinned clock is in — what the column should read. */
  const stepNow = () => Math.floor(clock.getTime() / STEP_MS);

  /** A workspace whose admin has just confirmed an authenticator at `clock`. */
  async function enrolled() {
    clock = new Date('2026-09-27T10:00:05.000Z');
    ctx = await buildTestApp({}, () => clock);
    const cookie = await setupOrg(ctx.app);
    await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie });
    const secret = await storedSecret(ADMIN.email);
    const confirmed = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/me/mfa/confirm',
      cookie,
      body: { code: codeAt(secret) },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return { cookie, secret, recoveryCodes: confirmed.json().recoveryCodes as string[] };
  }

  /** Password, then this code: a whole two-factor sign-in. */
  async function signIn(code: string) {
    return inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: (await login(ADMIN)).json().challengeToken, code },
    });
  }

  const lastStep = async () =>
    (await ctx.db.select().from(members).where(eq(members.email, ADMIN.email)))[0]!.mfaLastStep;

  it('accepts a code once, and refuses it again exactly as it refuses a wrong one', async () => {
    const { secret } = await enrolled();
    tick();
    const code = codeAt(secret);

    const first = await signIn(code);
    expect(first.statusCode, first.body).toBe(200);

    // Same code, same step, still inside its window.
    const replay = await signIn(code);
    const wrong = await signIn('000000');
    expect(replay.statusCode).toBe(422);
    // No new oracle: a spent code and a wrong one read back byte for byte alike.
    expect(replay.json()).toEqual(wrong.json());
    expect(replay.json().error.code).toBe('mfa_code_invalid');
  });

  it('decides on the database, not on the row a racing request read', async () => {
    const { secret } = await enrolled();
    tick();
    const code = codeAt(secret);

    // What two racing requests each hold: the member as it was before either
    // wrote. `app.inject` cannot make that race happen on demand, so the
    // service is handed the stale row twice — a check made on it would say
    // yes both times. The claim is a conditional UPDATE, so the second loses.
    const [stale] = await ctx.db.select().from(members).where(eq(members.email, ADMIN.email));
    expect(await verifyChallenge(ctx.db, stale!, code, clock)).toBe(true);
    expect(await verifyChallenge(ctx.db, stale!, code, clock)).toBe(false);
  });

  it('lets exactly one of several verifies racing the same code through', async () => {
    const { secret } = await enrolled();
    tick();
    const code = codeAt(secret);

    // One challenge (a second login would retire the first), verified four
    // times at once with one valid code. Whichever commits first wins; the
    // rest either find the challenge spent (401) or the step taken (422) —
    // both refusals the flow already gives, and no second session.
    const { challengeToken } = (await login(ADMIN)).json();
    const sessionsBefore = (await ctx.db.select().from(sessions)).length;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          body: { challengeToken, code },
        }),
      ),
    );

    const statuses = results.map((res) => res.statusCode);
    expect(
      statuses.filter((status) => status === 200),
      statuses.join(),
    ).toHaveLength(1);
    for (const status of statuses.filter((status) => status !== 200)) {
      expect([401, 422]).toContain(status);
    }
    expect(await ctx.db.select().from(sessions)).toHaveLength(sessionsBefore + 1);
  });

  it('spends a challenge once, even for a caller holding the row read before', async () => {
    await enrolled();
    const member = (await ctx.db.select().from(members).where(eq(members.email, ADMIN.email)))[0]!;
    const raw = await issueAuthToken(ctx.db, member.id, 'mfa_challenge', clock);

    // What two racing verifies each hold: the challenge as found before either
    // consumed it. The consume is a conditional UPDATE, so the second loses.
    const token = (await findValidToken(ctx.db, raw, 'mfa_challenge', clock))!;
    expect(await consumeToken(ctx.db, token.id, clock)).toBe(true);
    expect(await consumeToken(ctx.db, token.id, clock)).toBe(false);
  });

  it('spends a recovery code once when two verifies race for it', async () => {
    const { recoveryCodes } = await enrolled();
    const member = (await ctx.db.select().from(members).where(eq(members.email, ADMIN.email)))[0]!;
    const code = recoveryCodes[0]!;

    // Two transactions at once. On SQLite the write gate queues the second
    // behind the first; on Postgres they genuinely overlap, and a lookup
    // followed by an unconditional write would let both spend the one code.
    // The pool is warmed first, or the second transaction spends its head
    // start opening a connection and the first has committed by then.
    await Promise.all([0, 1, 2].map(() => ctx.db.select().from(members)));
    const results = await Promise.all(
      [0, 1].map(() => ctx.db.transaction(async (tx) => verifyChallenge(tx, member, code, clock))),
    );
    expect(results.sort()).toEqual([false, true]);
    const spent = (await ctx.db.select().from(mfaRecoveryCodes)).filter((row) => row.usedAt);
    expect(spent).toHaveLength(1);
  });

  it('lets exactly one of several verifies racing one recovery code through', async () => {
    const { recoveryCodes } = await enrolled();
    const code = recoveryCodes[0]!;

    const { challengeToken } = (await login(ADMIN)).json();
    const sessionsBefore = (await ctx.db.select().from(sessions)).length;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          body: { challengeToken, code },
        }),
      ),
    );

    // The loser finds the challenge spent (401) or the code spent (422) —
    // the answers a spent challenge and a wrong code already give.
    const statuses = results.map((res) => res.statusCode);
    expect(
      statuses.filter((status) => status === 200),
      statuses.join(),
    ).toHaveLength(1);
    for (const status of statuses.filter((status) => status !== 200)) {
      expect([401, 422]).toContain(status);
    }
    expect(await ctx.db.select().from(sessions)).toHaveLength(sessionsBefore + 1);
    const spent = (await ctx.db.select().from(mfaRecoveryCodes)).filter((row) => row.usedAt);
    expect(spent).toHaveLength(1);
  });

  it('does not let the code that confirmed the enrolment sign in as well', async () => {
    const { secret } = await enrolled();
    const confirming = codeAt(secret);
    tick(); // one step on: that code is still inside the window

    const res = await signIn(confirming);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('mfa_code_invalid');
  });

  it('accepts the next step’s code once an earlier one was used', async () => {
    const { secret } = await enrolled();
    tick();
    expect((await signIn(codeAt(secret))).statusCode).toBe(200);

    tick();
    const later = await signIn(codeAt(secret));
    expect(later.statusCode, later.body).toBe(200);
    expect(await lastStep()).toBe(stepNow());
  });

  it('refuses an earlier step inside the window once a later one was accepted', async () => {
    const { secret } = await enrolled();
    tick(2);
    // A phone running a step ahead: its code is inside the window, and taken.
    expect((await signIn(codeAt(secret, +1))).statusCode).toBe(200);

    // Neither of these was ever used, and both are inside the window — but
    // the guard is monotonic, not "the last code only".
    expect((await signIn(codeAt(secret))).statusCode).toBe(422);
    expect((await signIn(codeAt(secret, -1))).statusCode).toBe(422);
    expect(await lastStep()).toBe(stepNow() + 1);
  });

  it('leaves the recovery codes alone', async () => {
    const { secret, recoveryCodes } = await enrolled();
    tick();
    expect((await signIn(codeAt(secret))).statusCode).toBe(200);
    const recorded = await lastStep();

    // A recovery code in the same step still works, spends itself as before,
    // and neither reads nor moves the authenticator's step.
    const recovery = await signIn(recoveryCodes[0]!);
    expect(recovery.statusCode, recovery.body).toBe(200);
    expect(await lastStep()).toBe(recorded);
    expect((await signIn(recoveryCodes[0]!)).statusCode).toBe(422);
  });

  it('starts over when an admin resets the authenticator', async () => {
    const { secret } = await enrolled();
    tick();
    const session = sessionCookie(await signIn(codeAt(secret)));
    expect(await lastStep()).toBe(stepNow());

    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: session });
    const reset = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${me.json().member.id}/mfa/reset`,
      cookie: session,
    });
    expect(reset.statusCode).toBe(204);
    expect(await lastStep()).toBeNull();

    // A new authenticator, confirmed in the very step the old one last signed
    // in: a step recorded against the old secret means nothing to the new one.
    const fresh = sessionCookie(await login(ADMIN));
    await inject(ctx.app, { method: 'POST', url: '/api/v1/me/mfa/enroll', cookie: fresh });
    const confirmed = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/me/mfa/confirm',
      cookie: fresh,
      body: { code: codeAt(await storedSecret(ADMIN.email)) },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
  });

  it('forgets every step when the workspace switches two-factor off', async () => {
    const { cookie } = await enrolled();
    const patch = (mfaRequired: boolean) =>
      inject(ctx.app, { method: 'PATCH', url: '/api/v1/settings', cookie, body: { mfaRequired } });
    expect((await patch(true)).statusCode).toBe(200);
    expect(await lastStep()).toBe(stepNow());

    expect((await patch(false)).statusCode).toBe(200);
    for (const row of await ctx.db.select().from(members)) {
      expect(row.mfaLastStep, row.email).toBeNull();
    }
  });
});

describe('a reset link for somebody with an authenticator', () => {
  /** A reset link for the admin, minted the way the Members page's door mints one. */
  async function resetToken(email: string): Promise<string> {
    const [row] = await ctx.db.select().from(members).where(eq(members.email, email));
    return await issueAuthToken(ctx.db, row!.id, 'password_reset', new Date());
  }

  it('sets the password and then asks for the code, exactly as sign-in does', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);

    const reset = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      body: { token: await resetToken(ADMIN.email), newPassword: 'Another-horse-battery2' },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json()).toEqual({ mfaRequired: true, challengeToken: expect.any(String) });
    // The link is half of it, like the password: no session until the code.
    expect(reset.cookies.find((c) => c.name === 'inv_session')).toBeUndefined();
    expect(await ctx.db.select().from(sessions)).toEqual([]);

    const verified = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      body: { challengeToken: reset.json().challengeToken, code: await nextCode(ADMIN.email) },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    const me = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      cookie: sessionCookie(verified),
    });
    expect(me.json().member.email).toBe(ADMIN.email);

    // And the new password is the one that works now.
    const signIn = await login({ email: ADMIN.email, password: 'Another-horse-battery2' });
    expect(signIn.json().mfaRequired).toBe(true);
  });

  it('still signs straight in somebody with no authenticator', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);

    const reset = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      body: { token: await resetToken(ADMIN.email), newPassword: 'Another-horse-battery2' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().member.email).toBe(ADMIN.email);
    expect(sessionCookie(reset)).toMatch(/^inv_session=/);
  });
});
