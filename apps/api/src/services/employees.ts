import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { EmployeeCreateInput, EmployeePatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Db, DbOrTx } from '@/types/db.js';
import { assignments, employees } from '@/db/schema.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
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

/** How many assets each person currently holds, keyed by employee id. */
async function activeCounts(db: DbOrTx): Promise<Map<string, number>> {
  const rows = await db
    .select({ employeeId: assignments.employeeId, count: sql<number>`count(*)` })
    .from(assignments)
    .where(isNull(assignments.returnedAt))
    .groupBy(assignments.employeeId)
    .all();
  return new Map(rows.filter((row) => row.employeeId).map((row) => [row.employeeId!, row.count]));
}

/** Alphabetical: an employee list is scanned for a person, not for recency. */
export async function listEmployees(db: Db) {
  // activeCounts only has rows for people who hold something, so a miss below
  // is a genuine zero rather than a missing count.
  const counts = await activeCounts(db);
  return (
    await db
      .select()
      .from(employees)
      .orderBy(asc(employees.firstName), asc(employees.lastName))
      .all()
  ).map((employee) => serializeEmployee(employee, counts.get(employee.id) ?? 0));
}

/**
 * The employee page in one payload: the person, what they hold right now, and
 * what they have handed back. Splitting here rather than in the browser keeps
 * the page independent of whether the asset list happens to be cached.
 */
export async function getEmployeeDetail(db: Db, id: string) {
  const employee = await db.select().from(employees).where(eq(employees.id, id)).get();
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
    await tx
      .insert(employees)
      .values({
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
      })
      .run();

    const employeeName = `${input.firstName} ${input.lastName}`;
    await writeAudit(
      tx,
      {
        type: 'people',
        action: 'employee.created',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        employeeId: id,
        params: { employeeName, email: input.email },
      },
      now,
    );

    return serializeEmployee(
      (await tx.select().from(employees).where(eq(employees.id, id)).get())!,
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
    const current = await tx.select().from(employees).where(eq(employees.id, id)).get();
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
        .where(and(eq(assignments.employeeId, id), isNull(assignments.returnedAt)))
        .all();
      for (const assignment of open) {
        await tx
          .update(assignments)
          .set({ expectedReturnDate: patch.returnDueDate })
          .where(eq(assignments.id, assignment.id))
          .run();
      }
      scheduledReturns = open.length;
    }

    if (changedFields.length === 0 && !values.status) {
      return serializeEmployee(current, await countHeldBy(tx, id));
    }

    values.updatedAt = nowIso(now);
    await tx.update(employees).set(values).where(eq(employees.id, id)).run();

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
          actorName: actor.displayName,
          employeeId: id,
          // Offboarding without a return date is allowed; null records that.
          params: { employeeName, scheduledReturns, returnDueDate: patch.returnDueDate ?? null },
        },
        now,
      );
    }

    return serializeEmployee(
      (await tx.select().from(employees).where(eq(employees.id, id)).get())!,
      await countHeldBy(tx, id),
    );
  });
}

export async function deleteEmployee(deps: AppDeps, actor: Actor, id: string): Promise<void> {
  const now = deps.now();

  await deps.db.transaction(async (tx) => {
    const employee = await tx.select().from(employees).where(eq(employees.id, id)).get();
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
    await tx.delete(employees).where(eq(employees.id, id)).run();
    await writeAudit(
      tx,
      {
        type: 'people',
        action: 'employee.deleted',
        actorMemberId: actor.id,
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
      .all()
  ).length;
}

async function requireFreeEmail(tx: DbOrTx, email: string, exceptId?: string): Promise<void> {
  const where = exceptId
    ? and(eq(employees.email, email), ne(employees.id, exceptId))
    : eq(employees.email, email);
  if (await tx.select().from(employees).where(where).get()) {
    throw invalidFields({ email: 'Another employee already uses that email address.' });
  }
}
