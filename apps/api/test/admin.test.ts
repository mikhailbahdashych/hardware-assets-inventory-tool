import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_QUOTA_MB } from '@inventory/shared';
import {
  apiTokens,
  assets,
  attachments,
  auditEvents,
  employees,
  members,
  mfaRecoveryCodes,
  orgSettings,
} from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { mintApiToken } from '@/services/api-tokens.js';
import {
  buildTestApp,
  inject,
  memberCookie,
  setupOrg,
  SETUP_BODY,
  type TestApp,
} from './helpers.js';

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

async function createAsset(cookie: string, name = 'MacBook Pro 14"') {
  const res = await inject(ctx.app, {
    method: 'POST',
    url: '/api/v1/assets',
    cookie,
    body: { name, category: 'laptops', status: 'available' },
  });
  if (res.statusCode !== 200) throw new Error(`asset create failed: ${res.body}`);
  return res.json().asset as { id: string };
}

describe('the activity log', () => {
  it('is admin-only', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    for (const role of ['manager', 'viewer'] as const) {
      const res = await inject(ctx.app, {
        method: 'GET',
        url: '/api/v1/audit',
        cookie: await memberCookie(ctx.db, role),
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('returns newest first, with a count per filter pill', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie: admin,
      body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io' },
    });

    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/audit', cookie: admin });
    expect(res.statusCode).toBe(200);
    const { items, typeCounts, total } = res.json() as {
      items: { action: string; type: string; actorName: string }[];
      typeCounts: Record<string, number>;
      total: number;
    };

    expect(items.map((i) => i.action)).toEqual([
      'employee.created',
      'asset.created',
      'system.setup_completed',
    ]);
    expect(items[0]!.actorName).toBe(SETUP_BODY.name);
    expect(total).toBe(3);
    expect(typeCounts).toEqual({ all: 3, assets: 1, people: 1, auth: 0, system: 1 });
  });

  it('filters to one type without losing the counts for the others', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin);

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/audit?type=assets',
      cookie: admin,
    });
    const body = res.json() as { items: unknown[]; total: number; typeCounts: { all: number } };
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.typeCounts.all).toBe(2);
  });

  it('pages with limit and offset, so the pager can ask for any page', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    for (let i = 0; i < 4; i += 1) await createAsset(admin, `Asset ${i}`);

    const first = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?limit=2', cookie: admin })
    ).json() as { items: { params: Record<string, string> }[]; total: number };
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.items.map((i) => i.params.assetName)).toEqual(['Asset 3', 'Asset 2']);

    const next = (
      await inject(ctx.app, {
        method: 'GET',
        url: '/api/v1/audit?limit=2&offset=2',
        cookie: admin,
      })
    ).json() as { items: { params: Record<string, string> }[] };
    expect(next.items.map((i) => i.params.assetName)).toEqual(['Asset 1', 'Asset 0']);
  });

  it('carries the subject ids so a log line can link to what it is about', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const asset = await createAsset(admin);

    const items = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?type=assets', cookie: admin })
    ).json().items as { assetId: string | null; employeeId: string | null }[];
    expect(items[0]!.assetId).toBe(asset.id);
    expect(items[0]!.employeeId).toBeNull();
  });
});

describe('exporting the activity log', () => {
  it('sends a CSV attachment whose sentences match the screen', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin, 'MacBook Pro 14", "Space Black"');

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/audit/export',
      cookie: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="activity-log-/);

    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('Time,Actor,Event,Type');
    // A quote inside an asset name must not tear the row in half.
    expect(lines[1]).toContain('"Added MacBook Pro 14"", ""Space Black"" to the inventory"');
    expect(lines[1]).toMatch(/,Assets$/);
    expect(lines).toHaveLength(3);
  });

  it('honours the type filter the screen is showing', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin);

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/audit/export?type=system',
      cookie: admin,
    });
    expect(res.body.trim().split('\n')).toHaveLength(2);
  });
});

/**
 * A workspace where a person and a token have both written to the log, plus one
 * row from before `actor_kind` existed. Returns the admin's cookie.
 */
async function actedOnByBoth(): Promise<string> {
  const admin = await setupOrg(ctx.app);
  await createAsset(admin);

  const adminRow = (await ctx.db.select().from(members).where(eq(members.role, 'admin')))[0]!;
  const { token } = await mintApiToken(
    ctx.deps,
    { id: adminRow.id, displayName: adminRow.displayName },
    { name: 'Deploy bot', scopes: ['assets:write'], expiresInDays: 90 },
  );
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/public/v1/assets',
    headers: { authorization: `Bearer ${token}` },
    body: { name: 'Dell U2723QE', category: 'monitors', status: 'available' },
  });
  if (created.statusCode !== 200) throw new Error(`public create failed: ${created.body}`);
  return admin;
}

describe('filtering the activity log by who acted', () => {
  it('tells a token’s lines apart from a person’s', async () => {
    ctx = await buildTestApp();
    const admin = await actedOnByBoth();

    const byToken = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?actorKind=token', cookie: admin })
    ).json() as { items: { action: string; actorName: string }[]; total: number };
    expect(byToken.items.map((item) => item.action)).toEqual(['asset.created']);
    expect(byToken.items[0]!.actorName).toBe('Deploy bot');
    expect(byToken.total).toBe(1);

    const byPeople = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?actorKind=member', cookie: admin })
    ).json() as { items: { action: string }[]; total: number };
    expect(byPeople.items.map((item) => item.action)).toEqual([
      'token.created',
      'asset.created',
      'system.setup_completed',
    ]);
    expect(byPeople.total).toBe(3);
  });

  it('counts a row written before the column as the member who wrote it', async () => {
    ctx = await buildTestApp();
    const admin = await actedOnByBoth();
    // What an upgraded instance's whole history looks like: nothing backfills
    // the column, so a filter that read it literally would hide every row.
    await ctx.db.update(auditEvents).set({ actorKind: null }).where(eq(auditEvents.type, 'assets'));

    const byPeople = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?actorKind=member', cookie: admin })
    ).json() as { items: { action: string }[] };
    // The member's asset is back among their rows; the token's is not, because
    // a nulled kind on a row with no member id is the system's.
    expect(byPeople.items.filter((item) => item.action === 'asset.created')).toHaveLength(1);
  });

  it('keeps the pager and the pills on their own filters', async () => {
    ctx = await buildTestApp();
    const admin = await actedOnByBoth();

    const both = (
      await inject(ctx.app, {
        method: 'GET',
        url: '/api/v1/audit?actorKind=member&type=assets',
        cookie: admin,
      })
    ).json() as { items: unknown[]; total: number; typeCounts: Record<string, number> };
    // `total` is what the pager divides, so it obeys both filters…
    expect(both.items).toHaveLength(1);
    expect(both.total).toBe(1);
    // …while the pills count the actor's whole log, or switching one pill
    // would move the numbers on the others.
    expect(both.typeCounts).toEqual({ all: 3, assets: 1, people: 0, auth: 1, system: 1 });

    const actorOnly = (
      await inject(ctx.app, { method: 'GET', url: '/api/v1/audit?actorKind=member', cookie: admin })
    ).json() as { typeCounts: Record<string, number> };
    expect(actorOnly.typeCounts).toEqual(both.typeCounts);
  });

  it('exports what the screen is showing, actor filter and all', async () => {
    ctx = await buildTestApp();
    const admin = await actedOnByBoth();

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/audit/export?actorKind=token',
      cookie: admin,
    });
    const lines = res.body.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Deploy bot');
  });

  it('refuses an actor kind it does not have', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/audit?actorKind=robot',
      cookie: admin,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('workspace settings', () => {
  it('are admin-only to read and to change', async () => {
    ctx = await buildTestApp();
    await setupOrg(ctx.app);
    const manager = await memberCookie(ctx.db, 'manager');
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/settings', cookie: manager }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await inject(ctx.app, {
          method: 'PATCH',
          url: '/api/v1/settings',
          cookie: manager,
          body: { orgName: 'Not Yours' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('reports what setup created, plus the defaults nobody has touched', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    const res = await inject(ctx.app, { method: 'GET', url: '/api/v1/settings', cookie: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({
      orgName: 'Acme Corp',
      defaultCurrency: 'EUR',
      assetTagPrefix: 'AST',
      warrantyLeadDays: 60,
      logRetentionMonths: 12,
      warrantyAlerts: true,
    });
  });

  it('takes any whole number of days as the warranty lead time', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { warrantyLeadDays: 45 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.warrantyLeadDays).toBe(45);

    // Below a day is no notice at all, and beyond a year is not a warning.
    for (const days of [0, -1, 400, 12.5]) {
      const bad = await inject(ctx.app, {
        method: 'PATCH',
        url: '/api/v1/settings',
        cookie: admin,
        body: { warrantyLeadDays: days },
      });
      expect(bad.statusCode, `lead time ${days}`).toBe(422);
    }
  });

  it('writes only what changed, and audits it by name', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { orgName: 'Acme Corporation', assetTagPrefix: 'acme', returnReminders: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({
      orgName: 'Acme Corporation',
      assetTagPrefix: 'ACME',
      returnReminders: false,
    });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'system.settings_updated'));
    expect(event?.type).toBe('system');
    expect(JSON.parse(event!.params).changedFields).toEqual([
      'orgName',
      'assetTagPrefix',
      'returnReminders',
    ]);
  });

  it('carries the attachment quota and what the workspace has used of it', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const before = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/settings',
      cookie: admin,
    });
    expect(before.json().settings.uploadQuotaMb).toBe(2048);
    // Nothing uploaded yet, and a workspace with no files has used no bytes.
    expect(before.json().storageUsedBytes).toBe(0);

    const asset = await createAsset(admin);
    await ctx.db.insert(attachments).values({
      id: 'att-1',
      assetId: asset.id,
      filename: 'invoice.pdf',
      storedName: 'invoice.pdf',
      sizeBytes: 4096,
      mime: 'application/pdf',
      uploadedByMemberId: null,
      createdAt: nowIso(),
    });

    const after = await inject(ctx.app, { method: 'GET', url: '/api/v1/settings', cookie: admin });
    expect(after.json().storageUsedBytes).toBe(4096);
  });

  it('takes a quota inside its bounds and refuses one outside them', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const res = await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { uploadQuotaMb: 500 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.uploadQuotaMb).toBe(500);
    expect(
      JSON.parse(
        (
          await ctx.db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.action, 'system.settings_updated'))
        )[0]!.params,
      ).changedFields,
    ).toEqual(['uploadQuotaMb']);

    // Below a hundred megabytes is barely ten files; beyond a hundred
    // gigabytes is a promise about somebody else's volume.
    for (const quota of [0, 99, MAX_UPLOAD_QUOTA_MB + 1, 512.5]) {
      const bad = await inject(ctx.app, {
        method: 'PATCH',
        url: '/api/v1/settings',
        cookie: admin,
        body: { uploadQuotaMb: quota },
      });
      expect(bad.statusCode, `quota ${quota}`).toBe(422);
    }
  });

  it('writes nothing at all when the form is submitted unchanged', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { orgName: 'Acme Corp' },
    });
    expect(
      await ctx.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'system.settings_updated')),
    ).toEqual([]);
  });

  it('renames the workspace everywhere, including the public metadata', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { orgName: 'Globex', defaultCurrency: 'PLN' },
    });

    const meta = (await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' })).json();
    expect(meta).toMatchObject({ orgName: 'Globex', defaultCurrency: 'PLN' });
  });

  it('sets the prefix the next asset tag is generated from', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await inject(ctx.app, {
      method: 'PATCH',
      url: '/api/v1/settings',
      cookie: admin,
      body: { assetTagPrefix: 'INV' },
    });

    const res = await inject(ctx.app, {
      method: 'GET',
      url: '/api/v1/assets/next-tag',
      cookie: admin,
    });
    expect(res.json().assetTag).toBe('INV-0001');
  });
});

describe('deleting the workspace', () => {
  it('is admin-only and needs the organization name typed back', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    expect(
      (
        await inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/workspace/delete',
          cookie: await memberCookie(ctx.db, 'manager'),
          body: { confirmText: 'Acme Corp' },
        })
      ).statusCode,
    ).toBe(403);

    const wrong = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/workspace/delete',
      cookie: admin,
      body: { confirmText: 'acme corp' },
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.fields.confirmText).toBeTruthy();
    expect(await ctx.db.select().from(orgSettings)).toHaveLength(1);
  });

  /**
   * A credential for a workspace that no longer exists must not still open a
   * door. Nothing recalls the raw value once it is minted, so deleting the row
   * is the only revocation there is — and the danger zone's promise is that it
   * deletes everything.
   */
  it('takes the API tokens with it, so no raw value outlives the workspace', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);

    const minted = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/api-tokens',
      cookie: admin,
      body: { name: 'Deploy bot', scopes: ['assets:read'], expiresInDays: null },
    });
    expect(minted.statusCode).toBe(201);
    const raw: string = minted.json().token;
    // It opens the door before the wipe, so the 401 afterwards means something.
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/public/v1/assets',
          headers: { authorization: `Bearer ${raw}` },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await inject(ctx.app, {
          method: 'POST',
          url: '/api/v1/workspace/delete',
          cookie: admin,
          body: { confirmText: 'Acme Corp' },
        })
      ).statusCode,
    ).toBe(204);

    expect(await ctx.db.select().from(apiTokens)).toEqual([]);
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/public/v1/assets',
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('invalid_token');
  });

  it('wipes every table and leaves an instance that asks to be set up again', async () => {
    ctx = await buildTestApp();
    const admin = await setupOrg(ctx.app);
    await createAsset(admin);
    await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/employees',
      cookie: admin,
      body: { firstName: 'Maya', lastName: 'Lindqvist', email: 'maya@acme.io' },
    });

    const res = await inject(ctx.app, {
      method: 'POST',
      url: '/api/v1/workspace/delete',
      cookie: admin,
      body: { confirmText: 'Acme Corp' },
    });
    expect(res.statusCode).toBe(204);

    expect(await ctx.db.select().from(orgSettings)).toEqual([]);
    expect(await ctx.db.select().from(members)).toEqual([]);
    expect(await ctx.db.select().from(assets)).toEqual([]);
    expect(await ctx.db.select().from(employees)).toEqual([]);
    expect(await ctx.db.select().from(auditEvents)).toEqual([]);
    // Both credential tables go too — one by its own line, one by the cascade
    // that line does not rely on.
    expect(await ctx.db.select().from(apiTokens)).toEqual([]);
    expect(await ctx.db.select().from(mfaRecoveryCodes)).toEqual([]);

    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' })).json().needsSetup).toBe(
      true,
    );
    expect(
      (await inject(ctx.app, { method: 'GET', url: '/api/v1/assets', cookie: admin })).statusCode,
    ).toBe(401);

    // The custom-field definitions the boot seed creates come back, so the next
    // setup starts from the same place a fresh container would.
    const fresh = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      body: SETUP_BODY,
    });
    expect(fresh.statusCode).toBe(200);
  });
});
