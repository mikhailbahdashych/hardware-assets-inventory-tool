import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { members } from '@/db/schema.js';
import { removeMember, updateMember } from '@/services/members.js';
import { buildTestApp, inject, sessionCookie, setupOrg, type TestApp } from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/**
 * The one thing a workspace may never lose. An invited admin cannot sign in,
 * so they cannot administer anything — only active ones count.
 */
async function activeAdmins(): Promise<number> {
  return (
    await ctx.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.role, 'admin'), eq(members.status, 'active')))
      .all()
  ).length;
}

async function meId(cookie: string): Promise<string> {
  const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie });
  return res.json().member.id as string;
}

/** Invites somebody, accepts on their behalf, and returns their session. */
async function addMember(adminCookie: string, email: string, role: string) {
  const invite = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/members/invites',
    cookie: adminCookie,
    body: { email, role, sendEmail: false },
  });
  const token = new URL(invite.json().inviteUrl).searchParams.get('token');
  const accepted = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/auth/accept-invite',
    body: { token, name: email.split('@')[0], password: 'correct-horse-battery' },
  });
  return { cookie: sessionCookie(accepted), id: accepted.json().member.id as string };
}

describe('a workspace always keeps an admin', () => {
  it('refuses the last admin their own demotion and their own removal', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = await meId(admin);
    expect(await activeAdmins()).toBe(1);

    const demote = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${id}`,
      cookie: admin,
      body: { role: 'viewer' },
    });
    expect(demote.statusCode).toBe(409);

    const remove = await inject(ctx.app, {
      method: 'DELETE',
      url: `/api/v1/members/${id}`,
      cookie: admin,
    });
    expect(remove.statusCode).toBe(409);

    expect(await activeAdmins()).toBe(1);
  });

  it('survives a sequence of member operations that tries to empty it', async () => {
    ctx = await buildTestApp();
    const first = await setupOrg(ctx.app);
    const firstId = await meId(first);

    const second = await addMember(first, 'second@acme.io', 'admin');
    const third = await addMember(first, 'third@acme.io', 'manager');
    expect(await activeAdmins()).toBe(2);

    // Every operation a session can reach, in an order chosen to end up with
    // as few admins as the rules allow. The invariant is asserted after each.
    const operations: [string, () => Promise<{ statusCode: number }>][] = [
      [
        'promote the manager',
        () =>
          inject(ctx.app, {
            method: 'PATCH',
            url: `/api/v1/members/${third.id}`,
            cookie: first,
            body: { role: 'admin' },
          }),
      ],
      [
        'second demotes the third',
        () =>
          inject(ctx.app, {
            method: 'PATCH',
            url: `/api/v1/members/${third.id}`,
            cookie: second.cookie,
            body: { role: 'viewer' },
          }),
      ],
      [
        'second removes the first',
        () =>
          inject(ctx.app, {
            method: 'DELETE',
            url: `/api/v1/members/${firstId}`,
            cookie: second.cookie,
          }),
      ],
      [
        'second demotes itself',
        () =>
          inject(ctx.app, {
            method: 'PATCH',
            url: `/api/v1/members/${second.id}`,
            cookie: second.cookie,
            body: { role: 'viewer' },
          }),
      ],
      [
        'second removes itself',
        () =>
          inject(ctx.app, {
            method: 'DELETE',
            url: `/api/v1/members/${second.id}`,
            cookie: second.cookie,
          }),
      ],
    ];

    for (const [name, run] of operations) {
      await run();
      expect(await activeAdmins(), `after: ${name}`).toBeGreaterThan(0);
    }

    // The last one standing is still an admin, and still the only one.
    expect(await activeAdmins()).toBe(1);
  });

  it('does not count an invited admin, who cannot sign in to administer anything', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'pending@acme.io', role: 'admin', sendEmail: false },
    });

    // Two admin rows, one usable account.
    expect(await ctx.db.select().from(members).where(eq(members.role, 'admin')).all()).toHaveLength(
      2,
    );
    expect(await activeAdmins()).toBe(1);
  });
});

/**
 * The guard below the self-rule. Over HTTP it is unreachable today — the
 * caller is always an active admin acting on somebody else, so the target is
 * never the last one — which is exactly why it is worth testing directly.
 *
 * It exists for the two futures that would make it reachable: relaxing the
 * self-rule, or granting `members.manage` to a role other than admin. Either
 * change should meet a closed door rather than an empty workspace.
 */
describe('the last-admin guard itself', () => {
  it('refuses to demote the last admin, whoever is asking', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = await meId(admin);

    // A different actor id is what the self-rule would otherwise catch first.
    const asSomebodyElse = { id: 'not-this-member', displayName: 'Somebody Else' };
    await expect(updateMember(ctx.deps, asSomebodyElse, id, { role: 'viewer' })).rejects.toThrow(
      /only admin/i,
    );
    expect(await activeAdmins()).toBe(1);
  });

  it('refuses to remove the last admin, whoever is asking', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = await meId(admin);

    const asSomebodyElse = { id: 'not-this-member', displayName: 'Somebody Else' };
    await expect(removeMember(ctx.deps, asSomebodyElse, id)).rejects.toThrow(/only admin/i);
    expect(await activeAdmins()).toBe(1);
  });

  it('allows both once a second admin exists', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = await meId(admin);
    const second = await addMember(admin, 'second@acme.io', 'admin');
    expect(await activeAdmins()).toBe(2);

    const asSecond = { id: second.id, displayName: 'Second' };
    await updateMember(ctx.deps, asSecond, id, { role: 'viewer' });
    expect(await activeAdmins()).toBe(1);
  });

  it('does not stand in the way of changes that are not about the role', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const id = await meId(admin);

    // Linking the last admin to an employee record touches no admin count.
    const asSomebodyElse = { id: 'not-this-member', displayName: 'Somebody Else' };
    await expect(
      updateMember(ctx.deps, asSomebodyElse, id, { employeeId: null }),
    ).resolves.not.toThrow();
    expect(await activeAdmins()).toBe(1);
  });
});
