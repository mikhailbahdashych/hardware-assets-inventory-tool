import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { EmployeeCreateInput, EmployeePatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Db, DbOrTx } from '@/types/db.js';
import type { EmployeeListPage } from '@/types/employees.js';
import type { ListQuery } from '@/types/list.js';
import { assignments, employees } from '@/db/schema.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { DUPLICATE_EMPLOYEE_EMAIL } from '@/lib/unique.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { containsAny } from '@/lib/search.js';
import { serializeEmployee, serializeHolding } from '@/lib/serialize.js';
import type { Actor } from '@/types/audit.js';
import { writeAudit } from './audit.js';
import { employeeHistory } from './assignments.js';

const EDITABLE = [
  'firstName',
  'lastName',
  'email',
  'jobTitle',
  'department',
  'location',
  'employeeCode',
  'startDate',
] as const;

/**
 * How many assets each person on this page currently holds, keyed by employee
 * id. Scoped to the page rather than the workspace: the whole open-assignment
 * table is exactly the thing a paged list exists not to read.
 */
async function activeCounts(db: DbOrTx, employeeIds: string[]): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await db
    .select({ employeeId: assignments.employeeId, count: count() })
    .from(assignments)
    .where(and(isNull(assignments.returnedAt), inArray(assignments.employeeId, employeeIds)))
    .groupBy(assignments.employeeId);
  return new Map(rows.filter((row) => row.employeeId).map((row) => [row.employeeId!, row.count]));
}

/**
 * The fields the filter row has always matched. The full name is matched as one
 * string rather than each half, so "daniel ok" finds Daniel Okafor the way it
 * did when the browser was comparing against `displayName`. Exported because
 * the palette's `/search` matches the same ones.
 */
export const EMPLOYEE_SEARCH_FIELDS = [
  sql`${employees.firstName} || ' ' || ${employees.lastName}`,
  employees.email,
  employees.department,
  employees.jobTitle,
];

/**
 * One page of the employee list, alphabetical: a list of people is scanned for
 * a person, not for recency. `id` is the tiebreaker, so two namesakes cannot
 * swap places across a page boundary.
 */
export async function listEmployees(db: Db, query: ListQuery): Promise<EmployeeListPage> {
  const search = containsAny(query.q ?? '', EMPLOYEE_SEARCH_FIELDS);
  const rows = await db
    .select()
    .from(employees)
    .where(search)
    .orderBy(asc(employees.firstName), asc(employees.lastName), asc(employees.id))
    .limit(query.limit)
    .offset(query.offset);

  // activeCounts only has rows for people who hold something, so a miss below
  // is a genuine zero rather than a missing count.
  const counts = await activeCounts(
    db,
    rows.map((employee) => employee.id),
  );
  const [total] = await db.select({ value: count() }).from(employees).where(search);

  return {
    employees: rows.map((employee) => serializeEmployee(employee, counts.get(employee.id) ?? 0)),
    // A count query always answers with exactly one row; no row would be the
    // driver breaking its own contract, which is what the throw would say.
    total: total!.value,
  };
}

/**
 * The employee page in one payload: the person, what they hold right now, and
 * what they have handed back. Splitting here rather than in the browser keeps
 * the page independent of whether the asset list happens to be cached.
 */
export async function getEmployeeDetail(db: Db, id: string) {
  const [employee] = await db.select().from(employees).where(eq(employees.id, id));
  if (!employee) throw notFound('That employee');

  const records = (await employeeHistory(db, id)).map((row) =>
    serializeHolding(row.assignment, row.asset),
  );
  return {
    employee: serializeEmployee(employee, await countHeldBy(db, id)),
    holdings: records.filter((record) => record.returnedAt === null),
    history: records.filter((record) => record.returnedAt !== null),
  };
}

export async function createEmployee(deps: AppDeps, actor: Actor, input: EmployeeCreateInput) {
  const now = deps.now();
  const at = nowIso(now);

  return await deps.db.transaction(async (tx) => {
    await requireFreeEmail(tx, input.email);

    const id = newId();
    await tx.insert(employees).values({
      id,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      jobTitle: input.jobTitle,
      department: input.department,
      location: input.location,
      employeeCode: input.employeeCode,
      startDate: input.startDate,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });

    const employeeName = `${input.firstName} ${input.lastName}`;
    await writeAudit(
      tx,
      {
        type: 'people',
        action: 'employee.created',
        actorMemberId: actor.id,
        actorApiTokenId: actor.apiTokenId,
        actorName: actor.displayName,
        employeeId: id,
        params: { employeeName, email: input.email },
      },
      now,
    );

    return serializeEmployee(
      (await tx.select().from(employees).where(eq(employees.id, id)))[0]!,
      0,
    );
  });
}

export async function updateEmployee(
  deps: AppDeps,
  actor: Actor,
  id: string,
  patch: EmployeePatchInput,
) {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const [current] = await tx.select().from(employees).where(eq(employees.id, id));
    if (!current) throw notFound('That employee');

    const values: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const field of EDITABLE) {
      // Patch semantics: absent means "leave alone" (skipped above), so a
      // present field with no value means "clear it" — that is what NULL is.
      if (!(field in patch)) continue;
      const next = patch[field] ?? null;
      if (next === current[field]) continue;
      values[field] = next;
      changedFields.push(field);
    }
    if (typeof values.email === 'string') await requireFreeEmail(tx, values.email, id);

    const startsOffboarding = patch.status === 'offboarding' && current.status !== 'offboarding';
    if (patch.status && patch.status !== current.status) values.status = patch.status;

    // Offboarding optionally puts a return date on everything they still hold.
    let scheduledReturns = 0;
    if (startsOffboarding && patch.returnDueDate) {
      const open = await tx
        .select()
        .from(assignments)
        .where(and(eq(assignments.employeeId, id), isNull(assignments.returnedAt)));
      for (const assignment of open) {
        await tx
          .update(assignments)
          .set({ expectedReturnDate: patch.returnDueDate })
          .where(eq(assignments.id, assignment.id));
      }
      scheduledReturns = open.length;
    }

    if (changedFields.length === 0 && !values.status) {
      return serializeEmployee(current, await countHeldBy(tx, id));
    }

    values.updatedAt = nowIso(now);
    await tx.update(employees).set(values).where(eq(employees.id, id));

    // The audit line names the person as they are *after* the edit, so an
    // untouched half of the name reads from the stored row.
    const employeeName = `${values.firstName ?? current.firstName} ${values.lastName ?? current.lastName}`;
    if (changedFields.length > 0) {
      await writeAudit(
        tx,
        {
          type: 'people',
          action: 'employee.updated',
          actorMemberId: actor.id,
          actorApiTokenId: actor.apiTokenId,
          actorName: actor.displayName,
          employeeId: id,
          params: { employeeName, changedFields },
        },
        now,
      );
    }
    if (startsOffboarding) {
      await writeAudit(
        tx,
        {
          type: 'people',
          action: 'employee.offboarding_started',
          actorMemberId: actor.id,
          actorApiTokenId: actor.apiTokenId,
          actorName: actor.displayName,
          employeeId: id,
          // Offboarding without a return date is allowed; null records that.
          params: { employeeName, scheduledReturns, returnDueDate: patch.returnDueDate ?? null },
        },
        now,
      );
    }

    return serializeEmployee(
      (await tx.select().from(employees).where(eq(employees.id, id)))[0]!,
      await countHeldBy(tx, id),
    );
  });
}

export async function deleteEmployee(deps: AppDeps, actor: Actor, id: string): Promise<void> {
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, id));
    if (!employee) throw notFound('That employee');
    if ((await countHeldBy(tx, id)) > 0) {
      throw new AppError(
        409,
        'employee_holds_assets',
        'Check their assets in before removing this person.',
      );
    }

    // Past ownership records survive: employee_id goes NULL and the name
    // snapshot keeps the history readable.
    await tx.delete(employees).where(eq(employees.id, id));
    await writeAudit(
      tx,
      {
        type: 'people',
        action: 'employee.deleted',
        actorMemberId: actor.id,
        actorApiTokenId: actor.apiTokenId,
        actorName: actor.displayName,
        params: { employeeName: `${employee.firstName} ${employee.lastName}` },
      },
      now,
    );
  });
}

async function countHeldBy(db: DbOrTx, employeeId: string): Promise<number> {
  return (
    await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.employeeId, employeeId), isNull(assignments.returnedAt)))
  ).length;
}

async function requireFreeEmail(tx: DbOrTx, email: string, exceptId?: string): Promise<void> {
  const where = exceptId
    ? and(eq(employees.email, email), ne(employees.id, exceptId))
    : eq(employees.email, email);
  const [clash] = await tx.select().from(employees).where(where);
  if (clash) {
    throw invalidFields(DUPLICATE_EMPLOYEE_EMAIL);
  }
}
