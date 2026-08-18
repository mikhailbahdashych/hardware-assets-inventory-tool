import { and, asc, eq, ne } from 'drizzle-orm';
import { ADMIN_ROLE, type InviteInput, type MemberPatchInput } from '@inventory/shared';
import type { Config } from '@/types/config.js';
import type { AppDeps } from '@/types/app.js';
import type { Db, DbOrTx } from '@/types/db.js';
import type { Actor } from '@/types/audit.js';
import type {
  InviteLink,
  InviteResult,
  MemberRow,
  MemberSummary,
  ResetLink,
} from '@/types/members.js';
import { employees, members, roles } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { serializeMemberSummary } from '@/lib/serialize.js';
import { writeAudit } from './audit.js';
import { issueAuthToken } from './auth-tokens.js';
import { requireRole } from './roles.js';

// Members are the accounts that can sign in. Two rules run through everything
// here: you may not change or remove your own account (which is also what
// guarantees the workspace always keeps at least one active admin — the person
// doing the removing is one), and a token is only ever returned once, in the
// link, because the database stores nothing but its hash.

/** The web routes the copied links point at (see apps/web/src/routes.tsx). */
const INVITE_PATH = '/accept-invite';
const RESET_PATH = '/reset-password';

function tokenUrl(config: Config, path: string, raw: string): string {
  const url = new URL(path, config.appUrl);
  url.searchParams.set('token', raw);
  return url.toString();
}

export function listMembers(db: Db): MemberSummary[] {
  return db
    .select({ member: members, employee: employees })
    .from(members)
    .leftJoin(employees, eq(members.employeeId, employees.id))
    .orderBy(asc(members.displayName))
    .all()
    .map((row) => serializeMemberSummary(row.member, row.employee));
}

export function inviteMember(deps: AppDeps, actor: Actor, input: InviteInput): InviteResult {
  const now = deps.now();
  const at = nowIso(now);

  const { member, raw } = deps.db.transaction((tx) => {
    requireFreeEmail(tx, input.email);
    // Roles are rows, so the id on the form is checked against them here — the
    // schema can only say it is a non-empty string.
    const role = requireRole(tx, input.role);
    const employee = input.employeeId === null ? null : requireEmployee(tx, input.employeeId);

    const id = newId();
    tx.insert(members)
      .values({
        id,
        email: input.email,
        // Nobody has told us their name yet — accepting the invite does that.
        // A linked employee record already knows it; otherwise the email's own
        // local part stands in, so the design's two-line member cell is never
        // blank and nothing is invented.
        displayName: employee
          ? `${employee.firstName} ${employee.lastName}`
          : localPart(input.email),
        passwordHash: null,
        role: input.role,
        status: 'invited',
        employeeId: input.employeeId,
        createdAt: at,
        updatedAt: at,
      })
      .run();

    const raw = issueAuthToken(tx, id, 'invite', now);
    writeAudit(
      tx,
      {
        type: 'auth',
        action: 'member.invited',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        memberId: id,
        // The label, snapshotted: a role renamed next month must not rewrite
        // what this line already said.
        params: { email: input.email, role: role.label },
      },
      now,
    );
    return { member: readMember(tx, id), raw };
  });

  return { member, inviteUrl: tokenUrl(deps.config, INVITE_PATH, raw) };
}

/**
 * A fresh invitation link. Issuing one retires the previous unconsumed invite,
 * so a link that leaked stops working the moment an admin resends.
 */
export function resendInvite(deps: AppDeps, actor: Actor, id: string): InviteLink {
  const now = deps.now();

  const raw = deps.db.transaction((tx) => {
    const member = requireMember(tx, id);
    if (member.status !== 'invited') {
      throw new AppError(409, 'already_active', 'That member has already joined the workspace.');
    }
    const raw = issueAuthToken(tx, member.id, 'invite', now);
    writeAudit(
      tx,
      {
        type: 'auth',
        action: 'member.invite_resent',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        memberId: member.id,
        params: { email: member.email },
      },
      now,
    );
    return raw;
  });

  return { inviteUrl: tokenUrl(deps.config, INVITE_PATH, raw) };
}

/**
 * The recovery path on an instance with no SMTP: an admin copies this link and
 * hands it over in person. It is never given to an anonymous requester — that
 * is why /auth/forgot-password answers 204 and issues nothing.
 */
export function issueResetLink(deps: AppDeps, actor: Actor, id: string): ResetLink {
  const now = deps.now();

  const raw = deps.db.transaction((tx) => {
    const member = requireMember(tx, id);
    if (member.status !== 'active') {
      throw new AppError(
        409,
        'not_active',
        'That member has not accepted their invitation yet — resend the invite instead.',
      );
    }
    const raw = issueAuthToken(tx, member.id, 'password_reset', now);
    writeAudit(
      tx,
      {
        type: 'auth',
        action: 'member.reset_issued',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        memberId: member.id,
        params: { memberName: member.displayName },
      },
      now,
    );
    return raw;
  });

  return { resetUrl: tokenUrl(deps.config, RESET_PATH, raw) };
}

export function updateMember(
  deps: AppDeps,
  actor: Actor,
  id: string,
  patch: MemberPatchInput,
): MemberSummary {
  const now = deps.now();

  return deps.db.transaction((tx) => {
    const current = requireMember(tx, id);
    const values: Partial<typeof members.$inferInsert> = {};
    // Named outside the branch so the audit event below can snapshot its label
    // without asking the table a second time.
    let destination = null as ReturnType<typeof requireRole> | null;

    if (patch.role !== undefined && patch.role !== current.role) {
      if (id === actor.id) {
        throw new AppError(
          409,
          'self_role_change',
          'You cannot change your own role — ask another admin to do it.',
        );
      }
      destination = requireRole(tx, patch.role);
      // Losing the last admin is the one role change nobody may make.
      if (current.role === ADMIN_ROLE && patch.role !== ADMIN_ROLE) {
        assertNotLastAdmin(tx, current);
      }
      values.role = patch.role;
    }

    // undefined is absent ("leave the link alone"); null is the design's
    // "— No link —", which is a value.
    if (patch.employeeId !== undefined && patch.employeeId !== current.employeeId) {
      values.employeeId = patch.employeeId;
    }

    if (Object.keys(values).length === 0) return readMember(tx, id);

    values.updatedAt = nowIso(now);
    tx.update(members).set(values).where(eq(members.id, id)).run();

    if (values.role && destination) {
      // Both sides as labels. The role they came *from* may not exist by the
      // time anybody reads this line, which is exactly why it is snapshotted;
      // a row that is somehow gone already renders as the id it was.
      const from = tx.select().from(roles).where(eq(roles.id, current.role)).get();
      writeAudit(
        tx,
        {
          type: 'auth',
          action: 'member.role_changed',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          memberId: id,
          params: {
            memberName: current.displayName,
            from: from ? from.label : current.role,
            to: destination.label,
          },
        },
        now,
      );
    }
    if (patch.employeeId !== undefined && values.employeeId !== undefined) {
      const employee = values.employeeId === null ? null : requireEmployee(tx, values.employeeId);
      writeAudit(
        tx,
        {
          type: 'auth',
          action: 'member.link_changed',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          memberId: id,
          employeeId: values.employeeId,
          // null is the sentence's "unlinked" branch, not a missing name.
          params: {
            memberName: current.displayName,
            employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
          },
        },
        now,
      );
    }

    return readMember(tx, id);
  });
}

export function removeMember(deps: AppDeps, actor: Actor, id: string): void {
  const now = deps.now();

  deps.db.transaction((tx) => {
    const member = requireMember(tx, id);
    if (id === actor.id) {
      throw new AppError(
        409,
        'self_delete',
        'You cannot remove your own account — ask another admin to do it.',
      );
    }

    assertNotLastAdmin(tx, member);

    // sessions.member_id CASCADEs, so removing the row signs them out
    // everywhere; audit_events.actor_member_id is SET NULL, so what they did
    // stays in the log under their snapshotted name.
    tx.delete(members).where(eq(members.id, id)).run();
    writeAudit(
      tx,
      {
        type: 'auth',
        action: 'member.removed',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { memberName: member.displayName, email: member.email },
      },
      now,
    );
  });
}

/** One member, for a caller that has an id — the routes that mail them. */
export function memberById(db: DbOrTx, id: string): MemberSummary {
  return readMember(db, id);
}

function readMember(tx: DbOrTx, id: string): MemberSummary {
  const row = tx
    .select({ member: members, employee: employees })
    .from(members)
    .leftJoin(employees, eq(members.employeeId, employees.id))
    .where(eq(members.id, id))
    .get();
  if (!row) throw notFound('That member');
  return serializeMemberSummary(row.member, row.employee);
}

/**
 * The structural backstop under the self-rules: a workspace may never end up
 * with nobody who can administer it.
 *
 * **Over HTTP this cannot fire today**, and that is by design rather than an
 * oversight. `members.manage` is admin-only, and no admin may change or remove
 * their own account — so the caller is always an active admin acting on
 * somebody else, and the target is therefore never the last one.
 *
 * It exists for the two changes that would make it reachable: relaxing the
 * self-rule, or granting `members.manage` to another role. Either should meet a
 * closed door rather than an empty workspace, and `test/last-admin.test.ts`
 * calls the services directly to prove this one is real code and not scenery.
 *
 * Only **active** admins count. An invited admin has no password yet, so they
 * cannot sign in, so they cannot administer anything — counting them would let
 * the last usable admin go on the strength of an invitation nobody accepted.
 *
 * Anchored to `ADMIN_ROLE` rather than a literal, the way the workflow is
 * anchored to `ASSIGNED_STATUS`: every other role is a row a workspace edits,
 * and this one is the row it cannot.
 */
function assertNotLastAdmin(tx: DbOrTx, target: MemberRow): void {
  if (target.role !== ADMIN_ROLE || target.status !== 'active') return;

  const remaining = tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(eq(members.role, ADMIN_ROLE), eq(members.status, 'active'), ne(members.id, target.id)),
    )
    .all().length;

  if (remaining === 0) {
    throw new AppError(
      409,
      'last_admin',
      'This is the only admin in the workspace. Make somebody else an admin first.',
    );
  }
}

function requireMember(tx: DbOrTx, id: string): MemberRow {
  const member = tx.select().from(members).where(eq(members.id, id)).get();
  if (!member) throw notFound('That member');
  return member;
}

function requireEmployee(tx: DbOrTx, id: string) {
  const employee = tx.select().from(employees).where(eq(employees.id, id)).get();
  if (!employee) throw invalidFields({ employeeId: 'That employee record no longer exists.' });
  return employee;
}

function requireFreeEmail(tx: DbOrTx, email: string): void {
  if (tx.select().from(members).where(eq(members.email, email)).get()) {
    throw invalidFields({ email: 'Someone already signs in with that email address.' });
  }
}

/**
 * zod has already validated the address, so the "@" is always there — and an
 * address without one is all local part, which is the right answer anyway.
 */
function localPart(email: string): string {
  const [local] = email.split('@');
  return local ?? email;
}
