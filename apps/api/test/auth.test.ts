import { eq } from 'drizzle-orm';
import { ACTIONS } from '@inventory/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { auditEvents, authTokens, members, sessions } from '@/db/schema.js';
import { issueAuthToken } from '@/services/auth-tokens.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';
import {
  buildTestApp,
  inject,
  memberCookie,
  sessionCookie,
  setupOrg,
  SETUP_BODY,
  type TestApp,
} from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

describe('meta & setup', () => {
  it('reports needsSetup until first-run setup completes', async () => {
    ctx = await buildTestApp();
    const before = await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ needsSetup: true });
    expect(before.json().version).toMatch(/^\d+\.\d+\.\d+$/);

    const setup = await ctx.app.inject({ method: 'POST', url: '/api/v1/setup', body: SETUP_BODY });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().member).toMatchObject({
      email: 'tomasz@acme.io',
      displayName: 'Tomasz Kowalski',
      role: 'admin',
    });
    expect(setup.cookies.find((c) => c.name === 'inv_session')).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });

    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(after.json()).toMatchObject({ needsSetup: false, orgName: 'Acme Corp' });
  });

  it('rejects a second setup with 409', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const again = await ctx.app.inject({ method: 'POST', url: '/api/v1/setup', body: SETUP_BODY });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_initialized');
  });

  it('audits setup completion', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const events = await ctx.db.select().from(auditEvents);
    expect(events.some((e) => e.action === 'system.setup_completed' && e.type === 'system')).toBe(
      true,
    );
  });

  it('validates the setup payload with a field-level error envelope', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      body: { orgName: '', name: 'T', email: 'bad', password: 'short' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation');
  });
});

describe('login / logout / me', () => {
  it('signs in with correct credentials and audits it', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'Tomasz@acme.io', password: SETUP_BODY.password },
    });
    expect(res.statusCode).toBe(200);
    const cookie = sessionCookie(res);

    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json().member.email).toBe('tomasz@acme.io');

    const events = await ctx.db.select().from(auditEvents);
    expect(events.some((e) => e.action === 'auth.login' && e.type === 'auth')).toBe(true);
  });

  it('rejects wrong passwords and unknown emails identically', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'tomasz@acme.io', password: 'not-the-password' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'ghost@acme.io', password: 'whatever-here' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('rejects members that have not accepted their invite yet', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    await ctx.db.insert(members).values({
      id: newId(),
      email: 'invited@acme.io',
      displayName: 'invited@acme.io',
      passwordHash: null,
      role: 'viewer',
      status: 'invited',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'invited@acme.io', password: 'whatever-here' },
    });
    expect(res.statusCode).toBe(401);
  });

  /**
   * The web gates every affordance on this list rather than on a role name, so
   * it has to be the same answer `requireAction` gives — resolved server-side,
   * from the same rows, on the same request.
   */
  it('me carries the permissions this member’s role resolves to', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);

    const admin = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(admin.json().permissions).toEqual([...ACTIONS].sort());

    const viewer = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      cookie: await memberCookie(ctx.db, 'viewer'),
    });
    // Reads are open to everybody, so the viewer's list is empty and always was.
    expect(viewer.json().permissions).toEqual([]);
  });

  it('me returns 401 without a session and after logout', async () => {
    ctx = await buildTestApp();
    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await setupOrg(ctx.app);
    const out = await inject(ctx.app, { method: 'POST', url: '/api/v1/auth/logout', cookie });
    expect(out.statusCode).toBe(204);
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(me.statusCode).toBe(401);
  });

  it('extends a session that is close to expiry (sliding TTL)', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    await ctx.db.update(sessions).set({ expiresAt: soon });

    await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    const session = (await ctx.db.select().from(sessions))[0]!;
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 20 * 24 * 60 * 60 * 1000,
    );
  });

  it('rejects an expired session', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(me.statusCode).toBe(401);
  });
});

describe('preferences', () => {
  it('persists theme, density and widget visibility per member', async () => {
    ctx = await buildTestApp();
    const cookie = await setupOrg(ctx.app);
    const patch = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/me/prefs',
      cookie,
      body: { theme: 'dark', density: 'compact', widgets: { kpi: false } },
    });
    expect(patch.statusCode).toBe(200);
    const me = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(me.json().member).toMatchObject({
      theme: 'dark',
      density: 'compact',
      widgets: { kpi: false },
    });
  });
});

describe('invites', () => {
  async function createInvitedMember(role = 'viewer') {
    const id = newId();
    await ctx.db.insert(members).values({
      id,
      email: 'daniel@acme.io',
      displayName: 'daniel@acme.io',
      passwordHash: null,
      role,
      status: 'invited',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    const raw = await issueAuthToken(ctx.db, id, 'invite');
    return { id, raw };
  }

  it('exposes invite details and activates the member on accept', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const { id, raw } = await createInvitedMember();

    const details = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${raw}` });
    expect(details.statusCode).toBe(200);
    // The label as well as the id: this endpoint is unauthenticated, so the
    // accept page cannot fetch /roles to find out what the role is called.
    expect(details.json()).toMatchObject({
      email: 'daniel@acme.io',
      role: 'viewer',
      roleLabel: 'Viewer',
      orgName: 'Acme Corp',
    });

    const accept = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      body: { token: raw, name: 'Daniel Okafor', password: 'long-enough-password' },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().member).toMatchObject({ displayName: 'Daniel Okafor', status: 'active' });

    const [member] = await ctx.db.select().from(members).where(eq(members.id, id));
    expect(member?.status).toBe('active');
    expect(member?.passwordHash).toBeTruthy();

    // The name arrives with the invitation being accepted, so the event has to
    // carry it — otherwise the activity log can only say "A member joined".
    const [joined] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.joined'));
    expect(JSON.parse(joined!.params)).toMatchObject({
      memberName: 'Daniel Okafor',
      email: 'daniel@acme.io',
    });
  });

  it('rejects consumed and expired invite tokens', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const { raw } = await createInvitedMember();

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      body: { token: raw, name: 'Daniel', password: 'long-enough-password' },
    });
    const reuse = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${raw}` });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('invalid_token');

    await ctx.db
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString(), consumedAt: null });
    const expired = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${raw}` });
    expect(expired.statusCode).toBe(401);
  });
});

describe('password reset', () => {
  it('resets the password, revokes other sessions, and audits', async () => {
    ctx = await buildTestApp();
    const adminCookie = await setupOrg(ctx.app);
    const admin = (await ctx.db.select().from(members))[0]!;
    const raw = await issueAuthToken(ctx.db, admin.id, 'password_reset');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      body: { token: raw, newPassword: 'brand-new-password-1' },
    });
    expect(res.statusCode).toBe(200);

    // The pre-reset session is revoked; the response carries a fresh one.
    const staleMe = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      cookie: adminCookie,
    });
    expect(staleMe.statusCode).toBe(401);

    const oldLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: SETUP_BODY.email, password: SETUP_BODY.password },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: SETUP_BODY.email, password: 'brand-new-password-1' },
    });
    expect(newLogin.statusCode).toBe(200);

    const events = await ctx.db.select().from(auditEvents);
    expect(events.some((e) => e.action === 'auth.password_reset')).toBe(true);
  });

  it('forgot-password always answers 204 (no user enumeration)', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const known = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      body: { email: SETUP_BODY.email },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      body: { email: 'ghost@acme.io' },
    });
    expect(known.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(204);
  });
});

describe('healthz', () => {
  it('answers ok without authentication', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
