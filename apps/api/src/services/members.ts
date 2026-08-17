import { asc, eq } from 'drizzle-orm';
import type { InviteInput, MemberPatchInput } from '@inventory/shared';
import type { Config } from '@/config.js';
import type { AppDeps } from '@/types/app.js';
import type { Db, DbOrTx } from '@/types/db.js';
import type { Actor } from '@/types/audit.js';
import type { InviteResult, MemberSummary } from '@/types/members.js';
import type { MemberRow } from '@/plugins/session.js';
import { employees, members } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { serializeMemberSummary } from '@/lib/serialize.js';
import { writeAudit } from './audit.js';
import { issueAuthToken } from './auth-tokens.js';

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
        params: { email: input.email, role: input.role },
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
export function resendInvite(deps: AppDeps, actor: Actor, id: string): { inviteUrl: string } {
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
export function issueResetLink(deps: AppDeps, actor: Actor, id: string): { resetUrl: string } {
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

    if (patch.role !== undefined && patch.role !== current.role) {
      if (id === actor.id) {
        throw new AppError(
          409,
          'self_role_change',
          'You cannot change your own role — ask another admin to do it.',
        );
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

    if (values.role) {
      writeAudit(
        tx,
        {
          type: 'auth',
          action: 'member.role_changed',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          memberId: id,
          params: { memberName: current.displayName, from: current.role, to: values.role },
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

/** zod has already validated the address, so the "@" is always there. */
function localPart(email: string): string {
  const [local] = email.split('@');
  return local;
}
