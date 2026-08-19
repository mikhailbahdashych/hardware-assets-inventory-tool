import { eq, ne } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { members, mfaRecoveryCodes, orgSettings } from '@/db/schema.js';
import { hashToken } from '@/lib/tokens.js';
import { totpCode } from '@/lib/totp.js';
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

    expect(ctx.db.select().from(mfaRecoveryCodes).all()).toHaveLength(0);
    // Unlike the full reset, nothing here is un-protected: the authenticator
    // still stands, so the sessions it guards keep working.
    const row = ctx.db.select().from(members).where(eq(members.id, id)).get()!;
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

    const viewer = memberCookie(ctx.db, 'viewer');
    expect((await resetCodes(viewer, id)).statusCode).toBe(403);
    // And the refusal really refused: the codes are still there.
    expect(ctx.db.select().from(mfaRecoveryCodes).all()).toHaveLength(10);
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

  const totp = () => totpCode(storedSecret(ADMIN.email), new Date());

  /** Codes still in hand, straight off the table. */
  const unusedCount = () =>
    ctx.db
      .select()
      .from(mfaRecoveryCodes)
      .all()
      .filter((row) => row.usedAt === null).length;

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

    const codes = (await signIn(totp())).json().recoveryCodes as string[];

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);

    // The response is the only place they exist in the clear: what the table
    // holds is their hashes, and nothing else is left over from the old set.
    const stored = ctx.db.select().from(mfaRecoveryCodes).all();
    expect(stored.map((row) => row.codeHash).sort()).toEqual(codes.map(hashToken).sort());
    for (const row of stored) expect(row.usedAt).toBeNull();
  });

  it('says nothing about codes on an ordinary sign-in', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);

    // Nine still in hand, so nothing is reissued and the key is simply absent.
    expect((await signIn(totp())).json().recoveryCodes).toBeUndefined();
  });

  it('reissues in the very response that spent the last code', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const { recoveryCodes } = await enrol(cookie, ADMIN.email);
    const last = recoveryCodes[0]!;
    // Nine sign-ins' worth of spending, without nine logins the rate limiter
    // would rightly refuse. Marked used rather than deleted, exactly as
    // verifying with one leaves them.
    ctx.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: '2026-08-18T00:00:00.000Z' })
      .where(ne(mfaRecoveryCodes.codeHash, hashToken(last)))
      .run();

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
    const codes = (await signIn(totp())).json().recoveryCodes as string[];

    const again = await signIn(codes[0]!);
    expect(again.json().member.email).toBe(ADMIN.email);
    // Spent, not reissued: nine is not zero, so nothing was minted.
    expect(unusedCount()).toBe(9);
    expect(again.json().recoveryCodes).toBeUndefined();
  });

  it('records the reissue in the log, under the member who signed in', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await enrol(cookie, ADMIN.email);
    await resetCodes(cookie);
    const session = sessionCookie(await signIn(totp()));

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
    ctx.db.delete(mfaRecoveryCodes).run();

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
