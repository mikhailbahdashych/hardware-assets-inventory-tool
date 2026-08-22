import { eq } from 'drizzle-orm';
import { ADMIN_ROLE, deriveOutcome } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Actor } from '@/types/audit.js';
import type { DbOrTx } from '@/types/db.js';
import type { DemoAccount, DemoSeedOptions, DemoSeedResult } from '@/types/demo.js';
import type { RoleActor } from '@/types/roles.js';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  assetCustomValues,
  assets,
  assignments,
  auditEvents,
  customFieldDefs,
  employees,
  members,
  orgSettings,
} from '@/db/schema.js';
import {
  ASSETS,
  DEMO_ROLE,
  DEMO_STATUS,
  DEMO_TRANSITIONS,
  EMAIL_DOMAIN,
  HISTORY_DAYS,
  HOLDINGS,
  OFFBOARDING_DAYS_AGO,
  ORG_NAME,
  PEOPLE,
} from '@/db/demo-data.js';
import { AppError } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { addDays, nowIso, todayDate } from '@/lib/dates.js';
import { hashPassword } from '@/lib/password.js';
import { writeAudit } from '@/services/audit.js';
import { activeAssignment, closeAssignment, openAssignment } from '@/services/assignments.js';
import { updateMember } from '@/services/members.js';
import { createRole, listRoles, replacePermissions, requireRole } from '@/services/roles.js';
import { createStatus, replaceTransitions } from '@/services/workflow.js';
import { emptyWorkspace } from '@/services/workspace.js';

/**
 * A workspace with a story in it: a company, its people, the devices they hold,
 * and four months of history behind all three.
 *
 * Three properties make this worth having rather than a fixture dump:
 *
 * **It dates itself from the clock.** Every date in `demo-data.ts` is an offset
 * in days, resolved against `deps.now()` at seeding time — so a warranty always
 * expires next week, a return is always due in a few days, and the dashboard is
 * never a museum of 2026. A hosted demo can re-seed on a timer and stay current.
 *
 * **It goes through the real services.** Ownership is opened and closed by
 * `openAssignment`/`closeAssignment`, the only code allowed to pair
 * `status = 'assigned'` with an open row. The demo cannot drift from the
 * invariant, because it is subject to it.
 *
 * **It is deterministic.** No randomness anywhere: the same clock produces the
 * same workspace, so `--reset` genuinely restores rather than reshuffles.
 */
export async function seedDemo(deps: AppDeps, options: DemoSeedOptions): Promise<DemoSeedResult> {
  const existing = await deps.db.select().from(orgSettings).get();
  if (existing && !options.reset) {
    throw new AppError(
      409,
      'already_initialized',
      `This workspace is already set up as "${existing.orgName}". ` +
        `Re-run with --reset to empty it first — that deletes everything.`,
    );
  }
  if (existing) await emptyWorkspace(deps);

  const now = deps.now();
  // argon2 is deliberately slow, so hash the shared demo password once rather
  // than once per account. Every active demo login uses the same one anyway.
  const passwordHash = await hashPassword(options.password);

  const signIn: DemoAccount[] = [];

  const founder = PEOPLE.find((person) => person.account?.role === 'admin');
  if (!founder) throw new Error('The demo dataset has no admin to attribute its history to.');
  const actor: Actor = {
    id: newId(),
    displayName: `${founder.firstName} ${founder.lastName}`,
  };

  // The member ids come back out because the curation below promotes one of
  // them, and that has to happen after this transaction closes.
  const demoMembers = await deps.db.transaction(async (tx) => {
    // Negative reaches forward, which is how a warranty lands next month and a
    // return falls due next week. Event timestamps only ever pass positives —
    // the audit-log test is what holds the story out of the future.
    const at = (daysAgo: number, hour = 9, minute = 0): Date => {
      const day = addDays(now, -daysAgo);
      day.setUTCHours(hour, minute, 0, 0);
      return day;
    };

    await seedSettings(tx, now);

    const founderId = actor.id;
    const founderName = actor.displayName;

    const employeeIds = await seedPeople(tx, at);
    const memberIds = await seedMembers(tx, at, {
      founderId,
      founderName,
      passwordHash,
      employeeIds: employeeIds,
      signIn,
      password: options.password,
    });
    await auditPeopleAdded(tx, at, founderId, founderName, employeeIds);

    // Written after the founder's row exists, because `actor_member_id` is a
    // real foreign key — but stamped first, and the log is read by time.
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'system.setup_completed',
        actorMemberId: founderId,
        actorName: founderName,
        memberId: founderId,
        params: { orgName: ORG_NAME },
      },
      at(HISTORY_DAYS, 8, 30),
    );

    const assetIds = await seedAssets(tx, at, founderId, founderName);
    await seedCustomValues(tx, assetIds);
    await seedHoldings(tx, at, {
      founderId,
      founderName,
      employeeIds: employeeIds,
      assetIds: assetIds,
    });
    await seedOffboarding(tx, at, founderId, founderName, employeeIds);

    // A settings change and a couple of sign-ins, so the log's Auth and System
    // pills are not empty for the sake of a demo about an audit trail.
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'system.settings_updated',
        actorMemberId: founderId,
        actorName: founderName,
        params: { changedFields: ['warrantyLeadDays'] },
      },
      at(6, 11, 20),
    );
    for (const [key, daysAgo, hour] of [
      ['marco', 3, 8],
      ['ada', 1, 8],
      ['lena', 0, 7],
    ] as const) {
      const memberId = memberIds.get(key);
      const person = PEOPLE.find((candidate) => candidate.key === key);
      if (!memberId || !person) continue;
      await writeAudit(
        tx,
        {
          type: 'auth',
          action: 'auth.login',
          actorMemberId: memberId,
          actorName: `${person.firstName} ${person.lastName}`,
          memberId,
        },
        at(daysAgo, hour, 12),
      );
    }

    return memberIds;
  });

  await curateWorkflow(deps, actor);
  await curateRoles(deps, actor, { memberIds: demoMembers, signIn });

  return {
    orgName: ORG_NAME,
    signIn,
    counts: await countRows(deps.db),
  };
}

/**
 * The last thing the demo company did, and the last thing this seeder does.
 *
 * Order is the whole point. Everything above replays under the workflow a
 * fresh instance is seeded with — a full mesh between every non-assigned
 * status — and the curated graph below forbids several of the moves that
 * history contains. Applying it first would make the demo's own past illegal;
 * applying it last is also the truer story, because that is how a workspace
 * arrives at a workflow: it runs on the permissive default until somebody has
 * an opinion.
 *
 * It goes through the real service like everything else here, so the workflow
 * has been checked by the guards that protect it and the activity log carries
 * the change with the head of IT's name on it. Both calls open their own
 * transaction, which is why this sits outside the one above rather than in it.
 */
async function curateWorkflow(deps: AppDeps, actor: Actor): Promise<void> {
  await createStatus(deps, actor, DEMO_STATUS);
  await replaceTransitions(deps, actor, { transitions: [...DEMO_TRANSITIONS] });
}

interface RoleCurationContext {
  /** Member row ids by `PEOPLE` key, as {@link seedMembers} handed them back. */
  memberIds: Map<string, string>;
  /** The printed logins, so the promoted account says what it ended up as. */
  signIn: DemoAccount[];
}

/**
 * The other thing this company outgrew: three roles.
 *
 * Same shape as {@link curateWorkflow} and for the same reasons — three service
 * calls, each opening its own transaction, so the guards that protect roles
 * have checked this and the activity log carries it with the head of IT's name
 * on it. It runs last because that is the honest order: the workspace ran on
 * what it was seeded with until finance asked for the log, and the promotion at
 * the end only makes sense once the role exists to be promoted into.
 */
async function curateRoles(deps: AppDeps, actor: Actor, ctx: RoleCurationContext): Promise<void> {
  // Ada is the founder, so the guard against editing your own role never fires
  // here — Admin is the system role, and nothing below touches its column.
  const admin: RoleActor = { ...actor, role: ADMIN_ROLE };
  await createRole(deps, admin, {
    label: DEMO_ROLE.label,
    description: DEMO_ROLE.description,
    color: DEMO_ROLE.color,
  });

  // The matrix saves every non-system role's grants at once, so the two new
  // ticks arrive on top of what the seed gave Manager rather than instead of
  // it. Reading them back is also what makes this survive a change to
  // DEFAULT_ROLES without quietly revoking something.
  const stored = (await listRoles(deps.db))
    .filter((role) => !role.isSystem)
    .flatMap((role) => role.permissions.map((action) => ({ role: role.id, action })));
  await replacePermissions(deps, admin, {
    grants: [...stored, ...DEMO_ROLE.grants.map((action) => ({ role: DEMO_ROLE.id, action }))],
  });

  const person = PEOPLE.find((candidate) => candidate.key === DEMO_ROLE.holder);
  const holderId = ctx.memberIds.get(DEMO_ROLE.holder);
  if (!person || !holderId) {
    throw new Error(`demo-data: nobody keyed ${DEMO_ROLE.holder} has an account to promote.`);
  }
  await updateMember(deps, actor, holderId, { role: DEMO_ROLE.id });

  // The banner prints what each login *is*, and this one is no longer what it
  // was invited as. Nothing upstream can know that — the invitation happened
  // four months before the role existed — so the correction belongs here.
  const account = ctx.signIn.find(
    (row) => row.email === employeeEmail(person.firstName, person.lastName),
  );
  if (!account) throw new Error(`demo-data: ${DEMO_ROLE.holder} has no printed login to correct.`);
  account.role = DEMO_ROLE.id;
}

/** The workspace itself, on the design's defaults. */
async function seedSettings(tx: DbOrTx, now: Date): Promise<void> {
  await tx
    .insert(orgSettings)
    .values({
      id: 1,
      orgName: ORG_NAME,
      defaultCurrency: 'EUR',
      assetTagPrefix: 'AST',
      warrantyLeadDays: 45,
      logRetentionMonths: 12,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    })
    .run();
}

type Clock = (daysAgo: number, hour?: number, minute?: number) => Date;

/**
 * The employee rows only. Their audit events come later, from
 * {@link auditPeopleAdded} — `audit_events.actor_member_id` is a real foreign
 * key, and members cannot exist until the employees they link to do. So the
 * order is employees → members → the events that name both.
 */
async function seedPeople(tx: DbOrTx, at: Clock): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const [index, person] of PEOPLE.entries()) {
    const id = newId();
    ids.set(person.key, id);
    const added = at(person.addedDaysAgo, 10, index);

    await tx
      .insert(employees)
      .values({
        id,
        firstName: person.firstName,
        lastName: person.lastName,
        email: employeeEmail(person.firstName, person.lastName),
        jobTitle: person.jobTitle,
        department: person.department,
        location: person.location,
        employeeCode: `EMP-${String(index + 1).padStart(4, '0')}`,
        startDate: todayDate(at(person.startYearsAgo * 365 + 14)),
        // Offboarding is a later event, audited in its own right below.
        status: 'active',
        createdAt: nowIso(added),
        updatedAt: nowIso(added),
      })
      .run();
  }

  return ids;
}

/** The other half of {@link seedPeople}, once there is an actor to attribute to. */
async function auditPeopleAdded(
  tx: DbOrTx,
  at: Clock,
  actorId: string,
  actorName: string,
  ids: Map<string, string>,
): Promise<void> {
  for (const [index, person] of PEOPLE.entries()) {
    const id = ids.get(person.key);
    if (!id) continue;
    await writeAudit(
      tx,
      {
        type: 'people',
        action: 'employee.created',
        actorMemberId: actorId,
        actorName,
        employeeId: id,
        params: { employeeName: `${person.firstName} ${person.lastName}` },
      },
      at(person.addedDaysAgo, 10, index),
    );
  }
}

interface MemberSeedContext {
  founderId: string;
  founderName: string;
  passwordHash: string;
  employeeIds: Map<string, string>;
  signIn: DemoAccount[];
  password: string;
}

async function seedMembers(
  tx: DbOrTx,
  at: Clock,
  ctx: MemberSeedContext,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const [index, person] of PEOPLE.filter((person) => person.account).entries()) {
    const account = person.account;
    if (!account) continue;
    const displayName = `${person.firstName} ${person.lastName}`;
    const email = employeeEmail(person.firstName, person.lastName);
    // The founder's own row is the one the setup event was attributed to.
    const id = account.role === 'admin' ? ctx.founderId : newId();
    ids.set(person.key, id);

    const invitedAt = at(person.addedDaysAgo, 9, 30 + index);
    const active = account.status === 'active';

    await tx
      .insert(members)
      .values({
        id,
        email,
        displayName,
        // An invited member has not chosen a password yet — the column is
        // nullable precisely for this state, and the UI reads it as "Invited".
        passwordHash: active ? ctx.passwordHash : null,
        role: account.role,
        status: account.status,
        employeeId: ctx.employeeIds.get(person.key) ?? null,
        lastActiveAt: active ? nowIso(at(index, 8, 15)) : null,
        createdAt: nowIso(invitedAt),
        updatedAt: nowIso(invitedAt),
      })
      .run();

    if (active) {
      ctx.signIn.push({ email, password: ctx.password, role: account.role, displayName });
    }

    // The founder set the place up; nobody invited them.
    if (account.role !== 'admin') {
      await writeAudit(
        tx,
        {
          type: 'auth',
          action: 'member.invited',
          actorMemberId: ctx.founderId,
          actorName: ctx.founderName,
          memberId: id,
          // The label as the row spells it, snapshot at write time — the same
          // rule the members service follows, so a rename never rewrites the log.
          params: {
            email,
            role: account.role,
            roleLabel: (await requireRole(tx, account.role)).label,
          },
        },
        invitedAt,
      );
      if (active) {
        await writeAudit(
          tx,
          {
            type: 'auth',
            action: 'member.joined',
            actorMemberId: id,
            actorName: displayName,
            memberId: id,
            params: { memberName: displayName },
          },
          at(person.addedDaysAgo - 1, 14, index),
        );
      }
    }
  }

  return ids;
}

async function seedAssets(
  tx: DbOrTx,
  at: Clock,
  actorId: string,
  actorName: string,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const [index, asset] of ASSETS.entries()) {
    const id = newId();
    ids.set(asset.key, id);
    const added = at(asset.addedDaysAgo, 11, index % 50);
    const assetTag = `AST-${String(index + 1).padStart(4, '0')}`;

    await tx
      .insert(assets)
      .values({
        id,
        assetTag,
        name: asset.name,
        category: asset.category,
        model: asset.model,
        serialNumber: asset.serialNumber,
        status: asset.status,
        purchaseDate: todayDate(at(asset.purchasedDaysAgo)),
        // Money is integer cents everywhere; the dataset speaks whole euros.
        purchasePriceCents: asset.priceEuros * 100,
        // Null means "the organization default", which is what the UI renders.
        currency: null,
        supplier: asset.supplier,
        warrantyUntil: asset.warrantyInDays === null ? null : todayDate(at(-asset.warrantyInDays)),
        createdAt: nowIso(added),
        updatedAt: nowIso(added),
      })
      .run();

    await writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.created',
        actorMemberId: actorId,
        actorName,
        assetId: id,
        params: { assetName: asset.name, assetTag },
      },
      added,
    );
  }

  return ids;
}

/** The four boot-seeded custom fields, filled in for the machines that have them. */
async function seedCustomValues(tx: DbOrTx, assetIds: Map<string, string>): Promise<void> {
  const defs = new Map(
    (
      await tx
        .select({ id: customFieldDefs.id, key: customFieldDefs.key })
        .from(customFieldDefs)
        .all()
    ).map((row) => [row.key, row.id]),
  );

  for (const asset of ASSETS) {
    const assetId = assetIds.get(asset.key);
    if (!asset.custom || !assetId) continue;

    const values: [string, string | undefined][] = [
      ['hostname', asset.custom.hostname],
      ['cost_center', asset.custom.costCenter],
      ['mdm_enrolled', asset.custom.mdm === undefined ? undefined : String(asset.custom.mdm)],
      [
        'disk_encryption',
        asset.custom.encrypted === undefined ? undefined : String(asset.custom.encrypted),
      ],
    ];

    for (const [key, value] of values) {
      const fieldDefId = defs.get(key);
      if (value === undefined || !fieldDefId) continue;
      await tx.insert(assetCustomValues).values({ assetId, fieldDefId, value }).run();
    }
  }
}

interface HoldingSeedContext {
  founderId: string;
  founderName: string;
  employeeIds: Map<string, string>;
  assetIds: Map<string, string>;
}

/**
 * Replays the ownership history in order, through the same two functions the
 * API uses. Anything that cannot be resolved is a mistake in `demo-data.ts`
 * rather than a row to skip quietly — a demo missing half its history would
 * look like the app losing it.
 */
async function seedHoldings(tx: DbOrTx, at: Clock, ctx: HoldingSeedContext): Promise<void> {
  const ordered = [...HOLDINGS].sort((a, b) => b.fromDaysAgo - a.fromDaysAgo);

  for (const holding of ordered) {
    const assetId = ctx.assetIds.get(holding.assetKey);
    const employeeId = ctx.employeeIds.get(holding.personKey);
    const person = PEOPLE.find((candidate) => candidate.key === holding.personKey);
    const asset = ASSETS.find((candidate) => candidate.key === holding.assetKey);
    if (!assetId || !employeeId || !person || !asset) {
      throw new Error(
        `demo-data: holding ${holding.assetKey} → ${holding.personKey} names something that does not exist.`,
      );
    }

    const holderName = `${person.firstName} ${person.lastName}`;
    const out = at(holding.fromDaysAgo, 13, 0);

    await openAssignment(
      tx,
      {
        assetId,
        employeeId,
        holderName,
        checkedOutAt: todayDate(out),
        expectedReturnDate:
          holding.dueInDays === undefined ? null : todayDate(at(-holding.dueInDays)),
        notes: holding.notes ?? null,
      },
      out,
    );
    await writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.assigned',
        actorMemberId: ctx.founderId,
        actorName: ctx.founderName,
        assetId,
        employeeId,
        params: { assetName: asset.name, holderName },
      },
      out,
    );

    if (holding.untilDaysAgo === undefined) continue;

    const back = at(holding.untilDaysAgo, 15, 0);
    const open = await activeAssignment(tx, assetId);
    if (!open) {
      throw new Error(`demo-data: ${holding.assetKey} has no open record to close.`);
    }
    const newStatus = holding.returnedTo ?? 'available';
    // The same derivation the check-in endpoint uses, against the status the
    // holder had *then*. Somebody who is leaving now was not leaving in June,
    // and a log that says otherwise is a log that rewrites the past.
    const leavingAlready =
      person.status === 'offboarding' && holding.untilDaysAgo <= OFFBOARDING_DAYS_AGO;
    const outcome = deriveOutcome({
      holderStatus: leavingAlready ? 'offboarding' : 'active',
      newStatus,
    });

    await closeAssignment(
      tx,
      {
        assignment: open,
        returnedAt: todayDate(back),
        newStatus,
        condition: holding.condition ?? 'good',
        notes: holding.notes ?? null,
        outcome,
      },
      back,
    );
    await writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.checked_in',
        actorMemberId: ctx.founderId,
        actorName: ctx.founderName,
        assetId,
        employeeId,
        params: { assetName: asset.name, holderName, outcome },
      },
      back,
    );
  }
}

/**
 * The last thing that happened: somebody is leaving, and the two devices they
 * hold now have a return date. This is what fills the Pending returns widget.
 */
async function seedOffboarding(
  tx: DbOrTx,
  at: Clock,
  actorId: string,
  actorName: string,
  employeeIds: Map<string, string>,
): Promise<void> {
  for (const person of PEOPLE.filter((candidate) => candidate.status === 'offboarding')) {
    const id = employeeIds.get(person.key);
    if (!id) continue;
    const when = at(OFFBOARDING_DAYS_AGO, 16, 10);
    const displayName = `${person.firstName} ${person.lastName}`;

    await tx
      .update(employees)
      .set({ status: 'offboarding', updatedAt: nowIso(when) })
      .where(eq(employees.id, id))
      .run();

    const scheduledReturns = HOLDINGS.filter(
      (holding) => holding.personKey === person.key && holding.untilDaysAgo === undefined,
    ).length;

    await writeAudit(
      tx,
      {
        type: 'people',
        action: 'employee.offboarding_started',
        actorMemberId: actorId,
        actorName,
        employeeId: id,
        params: { employeeName: displayName, scheduledReturns },
      },
      when,
    );
  }
}

/** Lowercased at the boundary, like every other email in the product. */
function employeeEmail(firstName: string, lastName: string): string {
  const strip = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toLowerCase();
  return `${strip(firstName)}.${strip(lastName)}@${EMAIL_DOMAIN}`;
}

async function countRows(db: AppDeps['db']): Promise<DemoSeedResult['counts']> {
  const rows = async (table: SQLiteTable) => (await db.select().from(table).all()).length;
  return {
    members: await rows(members),
    employees: await rows(employees),
    assets: await rows(assets),
    assignments: await rows(assignments),
    auditEvents: await rows(auditEvents),
  };
}
