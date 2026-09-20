import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { members, rolePermissions } from '@/db/schema.js';
import { buildTestApp, inject, memberCookie, setupOrg, type TestApp } from './helpers.js';

// Nobody below admin acts on an admin — or mints one. `members.manage` is a
// grant any workspace role can hold, so without this rule a custom role would
// be a ladder over the very accounts that could revoke it: set an admin's
// password, or hold their reset link, and the workspace is yours.

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

/** The workspace granted a manager `members.manage` — the Roles page allows it. */
async function grantedManager(): Promise<string> {
  await ctx.db.insert(rolePermissions).values({ roleId: 'manager', action: 'members.manage' });
  return memberCookie(ctx.db, 'manager');
}

async function memberIdByRole(role: string): Promise<string> {
  return (await ctx.db.select().from(members).where(eq(members.role, role)))[0]!.id;
}

describe('the admin shield', () => {
  it('refuses a granted manager at every door that acts on an admin', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await grantedManager();
    const adminId = await memberIdByRole('admin');

    const doors = [
      ['POST', `/api/v1/members/${adminId}/password`, { newPassword: 'Attacker-chosen-pass1' }],
      ['POST', `/api/v1/members/${adminId}/reset-link`],
      ['POST', `/api/v1/members/${adminId}/resend-invite`],
      ['POST', `/api/v1/members/${adminId}/mfa/reset`],
      ['POST', `/api/v1/members/${adminId}/mfa/reset-codes`],
      ['PATCH', `/api/v1/members/${adminId}`, { role: 'viewer' }],
      ['DELETE', `/api/v1/members/${adminId}`],
    ] as const;
    for (const [method, url, body] of doors) {
      const res = await inject(ctx.app, { method, url, cookie: manager, body });
      expect(`${method} ${url} → ${res.statusCode}`).toBe(`${method} ${url} → 403`);
      expect(res.json().error.code).toBe('admin_shield');
    }
  });

  it('refuses minting an admin: by invitation and by promotion', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await grantedManager();
    await memberCookie(ctx.db, 'viewer');
    const viewerId = await memberIdByRole('viewer');

    const invite = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: manager,
      body: { email: 'accomplice@acme.io', role: 'admin' },
    });
    expect(invite.statusCode).toBe(403);
    expect(invite.json().error.code).toBe('admin_shield');

    const promote = await inject(ctx.app, {
      method: 'PATCH',
      url: `/api/v1/members/${viewerId}`,
      cookie: manager,
      body: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(403);
    expect(promote.json().error.code).toBe('admin_shield');
  });

  it('shields an admin who has not even joined yet', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const manager = await grantedManager();

    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/members/invites',
      cookie: admin,
      body: { email: 'second-admin@acme.io', role: 'admin' },
    });
    const invited = (
      await ctx.db.select().from(members).where(eq(members.email, 'second-admin@acme.io'))
    )[0]!;

    // A fresh invite link is account takeover for whoever holds it.
    const res = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${invited.id}/resend-invite`,
      cookie: manager,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('admin_shield');
  });

  it('still lets the granted manager manage everyone below the shield', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await grantedManager();
    await memberCookie(ctx.db, 'viewer');
    const viewerId = await memberIdByRole('viewer');

    const set = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${viewerId}/password`,
      cookie: manager,
      body: { newPassword: 'Handed-over-pass1' },
    });
    expect(set.statusCode).toBe(204);

    const link = await inject(ctx.app, {
      method: 'POST',
      url: `/api/v1/members/${viewerId}/reset-link`,
      cookie: manager,
    });
    expect(link.statusCode).toBe(200);
  });
});
