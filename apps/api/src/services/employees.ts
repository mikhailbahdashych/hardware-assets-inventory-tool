import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { EmployeeCreateInput, EmployeePatchInput } from '@inventory/shared';
import type { AppDeps } from '@/app.js';
import type { Db, DbOrTx } from '@/db/client.js';
import { assignments, employees } from '@/db/schema.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { serializeEmployee, type Actor } from '@/lib/serialize.js';
import { writeAudit } from './audit.js';

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
function activeCounts(db: DbOrTx): Map<string, number> {
  const rows = db
    .select({ employeeId: assignments.employeeId, count: sql<number>`count(*)` })
    .from(assignments)
    .where(isNull(assignments.returnedAt))
    .groupBy(assignments.employeeId)
    .all();
  return new Map(rows.filter((row) => row.employeeId).map((row) => [row.employeeId!, row.count]));
}

/** Alphabetical: an employee list is scanned for a person, not for recency. */
export function listEmployees(db: Db) {
  const counts = activeCounts(db);
  return db
    .select()
    .from(employees)
    .orderBy(asc(employees.firstName), asc(employees.lastName))
    .all()
    .map((employee) => serializeEmployee(employee, counts.get(employee.id) ?? 0));
}

export function getEmployee(db: Db, id: string) {
  const employee = db.select().from(employees).where(eq(employees.id, id)).get();
  if (!employee) throw notFound('That employee');
  return serializeEmployee(employee, countHeldBy(db, id));
}

export function createEmployee(deps: AppDeps, actor: Actor, input: EmployeeCreateInput) {
  const now = deps.now();
  const at = nowIso(now);

  return deps.db.transaction((tx) => {
    requireFreeEmail(tx, input.email);

    const id = newId();
    tx.insert(employees)
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
    writeAudit(
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

    return serializeEmployee(tx.select().from(employees).where(eq(employees.id, id)).get()!, 0);
  });
}

export function updateEmployee(deps: AppDeps, actor: Actor, id: string, patch: EmployeePatchInput) {
  const now = deps.now();

  return deps.db.transaction((tx) => {
    const current = tx.select().from(employees).where(eq(employees.id, id)).get();
    if (!current) throw notFound('That employee');

    const values: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const field of EDITABLE) {
      if (!(field in patch)) continue;
      const next = patch[field] ?? null;
      if (next === current[field]) continue;
      values[field] = next;
      changedFields.push(field);
    }
    if (typeof values.email === 'string') requireFreeEmail(tx, values.email, id);

    const startsOffboarding = patch.status === 'offboarding' && current.status !== 'offboarding';
    if (patch.status && patch.status !== current.status) values.status = patch.status;

    // Offboarding optionally puts a return date on everything they still hold.
    let scheduledReturns = 0;
    if (startsOffboarding && patch.returnDueDate) {
      const open = tx
        .select()
        .from(assignments)
        .where(and(eq(assignments.employeeId, id), isNull(assignments.returnedAt)))
        .all();
      for (const assignment of open) {
        tx.update(assignments)
          .set({ expectedReturnDate: patch.returnDueDate })
          .where(eq(assignments.id, assignment.id))
          .run();
      }
      scheduledReturns = open.length;
    }

    if (changedFields.length === 0 && !values.status) {
      return serializeEmployee(current, countHeldBy(tx, id));
    }

    values.updatedAt = nowIso(now);
    tx.update(employees).set(values).where(eq(employees.id, id)).run();

    const employeeName = `${values.firstName ?? current.firstName} ${values.lastName ?? current.lastName}`;
    if (changedFields.length > 0) {
      writeAudit(
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
      writeAudit(
        tx,
        {
          type: 'people',
          action: 'employee.offboarding_started',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          employeeId: id,
          params: { employeeName, scheduledReturns, returnDueDate: patch.returnDueDate ?? null },
        },
        now,
      );
    }

    return serializeEmployee(
      tx.select().from(employees).where(eq(employees.id, id)).get()!,
      countHeldBy(tx, id),
    );
  });
}

export function deleteEmployee(deps: AppDeps, actor: Actor, id: string): void {
  const now = deps.now();

  deps.db.transaction((tx) => {
    const employee = tx.select().from(employees).where(eq(employees.id, id)).get();
    if (!employee) throw notFound('That employee');
    if (countHeldBy(tx, id) > 0) {
      throw new AppError(
        409,
        'employee_holds_assets',
        'Check their assets in before removing this person.',
      );
    }

    // Past ownership records survive: employee_id goes NULL and the name
    // snapshot keeps the history readable.
    tx.delete(employees).where(eq(employees.id, id)).run();
    writeAudit(
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

function countHeldBy(db: DbOrTx, employeeId: string): number {
  return db
    .select()
    .from(assignments)
    .where(and(eq(assignments.employeeId, employeeId), isNull(assignments.returnedAt)))
    .all().length;
}

function requireFreeEmail(tx: DbOrTx, email: string, exceptId?: string): void {
  const where = exceptId
    ? and(eq(employees.email, email), ne(employees.id, exceptId))
    : eq(employees.email, email);
  if (tx.select().from(employees).where(where).get()) {
    throw invalidFields({ email: 'Another employee already uses that email address.' });
  }
}
