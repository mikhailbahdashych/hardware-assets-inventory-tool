import {
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  CURRENCY_LABELS,
  DATE_ONLY,
  matchEnumValue,
  parsePriceToCents,
  type AssetCategory,
  type AssetStatus,
  type Currency,
  type ImportValidateInput,
} from '@inventory/shared';
import type {
  ImportContext,
  ImportIssue,
  ImportPlan,
  ImportReport,
  PlannedAsset,
  PlannedEmployee,
} from '@/types/import.js';

/**
 * The whole import decision, in one pure function: what is wrong with the file,
 * what would happen if it were accepted, and the rows to write if it is.
 *
 * `/import/validate` shows the report and `/import/commit` writes the rows from
 * the same call, so the summary a person approved is exactly the work done —
 * and a client cannot skip the check by posting straight to commit.
 */
export function planImport(input: ImportValidateInput, context: ImportContext): ImportPlan {
  return input.kind === 'assets'
    ? planAssets(input.rows, context)
    : planEmployees(input.rows, context);
}

/** A cap on the lists, never on the counts: 150 broken rows is not 150 messages. */
const MAX_ISSUES = 100;

/** Collects issues, remembering that it stopped listing them. */
class Issues {
  readonly errors: ImportIssue[] = [];
  readonly warnings: ImportIssue[] = [];
  errorsTruncated = false;
  warningsTruncated = false;

  error(row: number, column: string, message: string): void {
    if (this.errors.length < MAX_ISSUES) this.errors.push({ row, column, message });
    else this.errorsTruncated = true;
  }

  warn(row: number, column: string, message: string): void {
    if (this.warnings.length < MAX_ISSUES) this.warnings.push({ row, column, message });
    else this.warningsTruncated = true;
  }
}

/** Header is line 1, so the first data row is line 2 — what a spreadsheet shows. */
const lineOf = (index: number): number => index + 2;

/** Trimmed cell text; an absent column and a blank one mean the same thing. */
function cell(row: Record<string, string>, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value.trim() : '';
}

/** Blank is NULL: every optional column here is nullable in the database. */
const orNull = (value: string): string | null => (value === '' ? null : value);

function planAssets(rows: Record<string, string>[], context: ImportContext): ImportPlan {
  const issues = new Issues();
  const planned: PlannedAsset[] = [];
  const seenTags = new Set<string>();

  rows.forEach((row, index) => {
    const line = lineOf(index);
    let ok = true;
    const fail = (column: string, message: string) => {
      issues.error(line, column, message);
      ok = false;
    };

    const assetTag = cell(row, 'asset_tag');
    const name = cell(row, 'name');
    const categoryCell = cell(row, 'category');

    if (assetTag === '') fail('asset_tag', 'An asset tag is required.');
    else if (seenTags.has(assetTag)) fail('asset_tag', `This file uses the tag ${assetTag} twice.`);
    else if (context.existingAssetTags.has(assetTag)) {
      fail('asset_tag', `${assetTag} already exists in the inventory.`);
    }
    seenTags.add(assetTag);

    if (name === '') fail('name', 'A name is required.');

    let category: AssetCategory | null = null;
    if (categoryCell === '') fail('category', 'A category is required.');
    else {
      category = matchEnumValue(ASSET_CATEGORY_LABELS, categoryCell);
      if (!category) fail('category', `"${categoryCell}" is not one of the categories.`);
    }

    // Absent status means the default the asset form starts on.
    const statusCell = cell(row, 'status');
    let status: AssetStatus = 'available';
    if (statusCell !== '') {
      const matched = matchEnumValue(ASSET_STATUS_LABELS, statusCell);
      if (!matched) fail('status', `"${statusCell}" is not one of the statuses.`);
      else status = matched;
    }

    const purchaseDate = readDate(row, 'purchase_date', fail);
    const warrantyUntil = readDate(row, 'warranty_until', fail);

    let purchasePriceCents: number | null = null;
    const priceCell = cell(row, 'purchase_price');
    if (priceCell !== '') {
      const parsed = parsePriceToCents(priceCell);
      if (!parsed.ok) fail('purchase_price', parsed.reason);
      else purchasePriceCents = parsed.cents;
    }

    // Blank currency is the design's normal case: an asset stores one only when
    // it differs from the organization default, so NULL is a meaning, not a gap.
    let currency: Currency | null = null;
    const currencyCell = cell(row, 'currency');
    if (currencyCell !== '') {
      currency = matchEnumValue(CURRENCY_LABELS, currencyCell);
      if (!currency) fail('currency', `"${currencyCell}" is not a currency this build knows.`);
    }

    // Who holds it, which is also the only thing that may set status=assigned.
    const holderEmail = cell(row, 'assigned_to_email').toLowerCase();
    let assignedToEmployeeId: string | null = null;
    if (status === 'assigned') {
      const employeeId =
        holderEmail === '' ? undefined : context.employeeIdByEmail.get(holderEmail);
      if (!employeeId) {
        issues.warn(
          line,
          'assigned_to_email',
          holderEmail === ''
            ? 'Marked Assigned with nobody to assign it to — imported as Available.'
            : `No employee has the address ${holderEmail} — imported as Available.`,
        );
        status = 'available';
      } else if (context.employeeStatusById.get(employeeId) !== 'active') {
        fail('assigned_to_email', `${holderEmail} is offboarding and cannot be given an asset.`);
      } else {
        assignedToEmployeeId = employeeId;
      }
    } else if (holderEmail !== '') {
      issues.warn(
        line,
        'assigned_to_email',
        `Ignored: the row is ${ASSET_STATUS_LABELS[status]}, not Assigned.`,
      );
    }

    if (!ok || !category) return;
    planned.push({
      rowNumber: line,
      assetTag,
      name,
      category,
      serialNumber: orNull(cell(row, 'serial_number')),
      status,
      assignedToEmployeeId,
      holderName: null,
      purchaseDate,
      purchasePriceCents,
      currency,
      supplier: orNull(cell(row, 'supplier')),
      warrantyUntil,
      notes: orNull(cell(row, 'notes')),
    });
  });

  return {
    kind: 'assets',
    report: report(rows.length, planned.length, planned.length, 0, issues),
    rows: planned,
  };
}

function planEmployees(rows: Record<string, string>[], context: ImportContext): ImportPlan {
  const issues = new Issues();
  const planned: PlannedEmployee[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    const line = lineOf(index);
    let ok = true;
    const fail = (column: string, message: string) => {
      issues.error(line, column, message);
      ok = false;
    };

    const firstName = cell(row, 'first_name');
    const lastName = cell(row, 'last_name');
    const email = cell(row, 'email').toLowerCase();

    if (firstName === '') fail('first_name', 'A first name is required.');
    if (lastName === '') fail('last_name', 'A last name is required.');

    if (email === '') fail('email', 'A work email is required.');
    else if (!EMAIL.test(email)) fail('email', `"${email}" is not an email address.`);
    else if (seenEmails.has(email)) fail('email', `This file uses ${email} twice.`);
    seenEmails.add(email);

    const startDate = readDate(row, 'start_date', fail);

    if (!ok) return;
    planned.push({
      rowNumber: line,
      firstName,
      lastName,
      email,
      jobTitle: orNull(cell(row, 'job_title')),
      department: orNull(cell(row, 'department')),
      location: orNull(cell(row, 'location')),
      employeeCode: orNull(cell(row, 'employee_id')),
      startDate,
      // A known address updates that person rather than adding a second one.
      existingId: context.employeeIdByEmail.get(email) ?? null,
    });
  });

  const updates = planned.filter((entry) => entry.existingId !== null).length;
  return {
    kind: 'employees',
    report: report(rows.length, planned.length, planned.length - updates, updates, issues),
    rows: planned,
  };
}

/**
 * Deliberately simpler than a full address grammar: this only has to reject the
 * things a spreadsheet actually contains ("maya at acme", "Maya <m@acme.io>").
 * The database's UNIQUE index and the invite flow are the real gatekeepers.
 */
// The middle class excludes `.` so the dot-separated tail has exactly one way
// to match. The previous shape let both halves consume dots, so a cell like
// "a@b.b.b.…<" made the engine try every split point and rescan the tail from
// each — quadratic, synchronous, and enough to stall the process for minutes
// from one import. `packages/shared/src/schemas/import.ts` caps the cell length
// as well; either alone would do, and together the cost is bounded twice.
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>.]+(\.[^\s@,;<>.]+)+$/;

function readDate(
  row: Record<string, string>,
  column: string,
  fail: (column: string, message: string) => void,
): string | null {
  const value = cell(row, column);
  if (value === '') return null;
  if (!DATE_ONLY.test(value)) {
    fail(column, `"${value}" is not a date — write it as YYYY-MM-DD.`);
    return null;
  }
  return value;
}

function report(
  totalRows: number,
  validCount: number,
  createCount: number,
  updateCount: number,
  issues: Issues,
): ImportReport {
  return {
    totalRows,
    validCount,
    createCount,
    updateCount,
    errors: issues.errors,
    warnings: issues.warnings,
    errorsTruncated: issues.errorsTruncated,
    warningsTruncated: issues.warningsTruncated,
  };
}
