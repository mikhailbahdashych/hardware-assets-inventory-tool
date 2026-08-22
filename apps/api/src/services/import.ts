import { eq } from 'drizzle-orm';
import { ASSIGNED_STATUS, type ImportCommitInput, type ImportValidateInput } from '@inventory/shared'; // prettier-ignore
import type { AppDeps } from '@/types/app.js';
import type { Actor } from '@/types/audit.js';
import type { DbOrTx } from '@/types/db.js';
import type {
  ImportContext,
  ImportReport,
  ImportResult,
  PlannedAsset,
  PlannedEmployee,
} from '@/types/import.js';
import { assets, employees } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { AppError } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { writeAudit } from './audit.js';
import { openAssignment } from './assignments.js';
import { planImport } from './import-validator.js';
import { getWorkflow } from './workflow.js';

/** Note left on the ownership records an import opens, so history says why. */
const IMPORT_NOTE = 'Imported via CSV';

/** Reads the state a row is judged against: existing tags, people, statuses. */
async function importContext(db: DbOrTx): Promise<ImportContext> {
  const tags = await db.select({ assetTag: assets.assetTag }).from(assets).all();
  const people = await db
    .select({ id: employees.id, email: employees.email, status: employees.status })
    .from(employees)
    .all();

  return {
    existingAssetTags: new Set(tags.map((row) => row.assetTag)),
    employeeIdByEmail: new Map(people.map((row) => [row.email, row.id])),
    employeeStatusById: new Map(people.map((row) => [row.id, row.status])),
    // Read inside the same transaction on commit, so a status deleted between
    // the dry run and the write cannot let a row through under an old name.
    statuses: (await getWorkflow(db)).statuses,
  };
}

/** The dry run: the same plan commit will make, with nothing written. */
export async function validateImport(
  deps: AppDeps,
  input: ImportValidateInput,
): Promise<ImportReport> {
  return planImport(input, await importContext(deps.db)).report;
}

/**
 * Writes a file in one transaction, having re-planned it from scratch — a
 * client cannot post straight here to skip the dry run, and nothing half-lands:
 * any error at all and the whole file is refused.
 */
export async function commitImport(
  deps: AppDeps,
  actor: Actor,
  input: ImportCommitInput,
): Promise<ImportResult> {
  const now = deps.now();

  return await deps.db.transaction(async (tx) => {
    const plan = planImport(input, await importContext(tx));
    const { errors, errorsTruncated } = plan.report;
    if (errors.length > 0) {
      const count = errorsTruncated ? `${errors.length}+` : `${errors.length}`;
      throw new AppError(
        422,
        'import_invalid',
        `${count} ${errors.length === 1 ? 'row' : 'rows'} in this file cannot be imported.`,
      );
    }

    const result: ImportResult =
      plan.kind === 'assets'
        ? await writeAssets(tx, plan.rows, now)
        : await writeEmployees(tx, plan.rows, now);

    // One event for the import, not one per row: a log that scrolls for pages
    // after a bulk load is a log nobody reads afterwards.
    await writeAudit(
      tx,
      {
        type: 'system',
        action: 'system.import_completed',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { kind: result.kind, created: result.created, updated: result.updated },
      },
      now,
    );
    return result;
  });
}

async function writeAssets(tx: DbOrTx, rows: PlannedAsset[], now: Date): Promise<ImportResult> {
  const at = nowIso(now);

  // Where a row that arrives Assigned is inserted before `openAssignment`
  // moves it — that function is the only code allowed to pair `assigned` with
  // an ownership row, and it runs a few lines later in the same transaction.
  // Read once rather than per row: a file may hold thousands.
  const free = (await getWorkflow(tx)).statuses.find((status) => !status.isSystem);
  if (!free) {
    throw new AppError(
      500,
      'workflow_empty',
      'This workspace has no status to import an asset into.',
    );
  }

  for (const row of rows) {
    const id = newId();
    await tx
      .insert(assets)
      .values({
        id,
        assetTag: row.assetTag,
        name: row.name,
        category: row.category,
        model: null,
        serialNumber: row.serialNumber,
        // openAssignment below is what actually sets `assigned`, so the row
        // never exists in that state without its ownership record. The planner
        // only leaves `assigned` standing when it found an active holder.
        status: row.status === ASSIGNED_STATUS ? free.id : row.status,
        purchaseDate: row.purchaseDate,
        purchasePriceCents: row.purchasePriceCents,
        currency: row.currency,
        supplier: row.supplier,
        warrantyUntil: row.warrantyUntil,
        notes: row.notes,
        createdAt: at,
        updatedAt: at,
      })
      .run();

    if (row.status === 'assigned' && row.assignedToEmployeeId !== null) {
      const holder = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, row.assignedToEmployeeId))
        .get();
      // The planner only sets this id from the employee table inside the same
      // transaction, so a miss here is a broken invariant, not a missing row.
      if (!holder) {
        throw new AppError(
          500,
          'import_holder_missing',
          `Row ${row.rowNumber} names an employee that vanished mid-import.`,
        );
      }
      await openAssignment(
        tx,
        {
          assetId: id,
          employeeId: holder.id,
          holderName: `${holder.firstName} ${holder.lastName}`,
          checkedOutAt: row.purchaseDate ?? at.slice(0, 10),
          expectedReturnDate: null,
          notes: IMPORT_NOTE,
        },
        now,
      );
    }
  }

  return { kind: 'assets', created: rows.length, updated: 0 };
}

async function writeEmployees(
  tx: DbOrTx,
  rows: PlannedEmployee[],
  now: Date,
): Promise<ImportResult> {
  const at = nowIso(now);
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const values = {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      jobTitle: row.jobTitle,
      department: row.department,
      location: row.location,
      employeeCode: row.employeeCode,
      startDate: row.startDate,
    };

    if (row.existingId === null) {
      await tx
        .insert(employees)
        .values({ id: newId(), ...values, status: 'active', createdAt: at, updatedAt: at })
        .run();
      created += 1;
      continue;
    }

    // An update keeps the row — its id is what assignments and member links
    // hang off — and never touches `status`: an import is not a way to bring
    // somebody back from offboarding.
    await tx
      .update(employees)
      .set({ ...values, updatedAt: at })
      .where(eq(employees.id, row.existingId))
      .run();
    updated += 1;
  }

  return { kind: 'employees', created, updated };
}
