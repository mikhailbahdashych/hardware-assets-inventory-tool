import type { AssetCategory, AssetStatus, Currency, ImportKind } from '@inventory/shared';

// What the importer needs to know about the workspace before it can judge a
// row, and what it produces: a report for the dry-run screen and rows ready to
// write. Validate and commit run the same planner, so the summary a person
// approved is the work that actually happens.

export interface ImportContext {
  /** Assets are insert-only, so an existing tag is a row error. */
  existingAssetTags: Set<string>;
  /** Employees are matched by email: a hit is an update, a miss is a create. */
  employeeIdByEmail: Map<string, string>;
  /** Only an active employee may be handed an asset. */
  employeeStatusById: Map<string, string>;
}

/** One thing wrong (or worth saying) about one cell. */
export interface ImportIssue {
  /** 1-based including the header, so it matches what a spreadsheet shows. */
  row: number;
  column: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  /** Rows that would be written. Errors block; warnings do not. */
  validCount: number;
  createCount: number;
  updateCount: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** True when the lists were capped — the counts above are still exact. */
  errorsTruncated: boolean;
  warningsTruncated: boolean;
}

export interface PlannedAsset {
  rowNumber: number;
  assetTag: string;
  name: string;
  category: AssetCategory;
  serialNumber: string | null;
  status: AssetStatus;
  /** Set only when the row is assigned to an active employee. */
  assignedToEmployeeId: string | null;
  /** Filled in by the writer from the employee row; the planner never guesses. */
  holderName: string | null;
  purchaseDate: string | null;
  purchasePriceCents: number | null;
  currency: Currency | null;
  supplier: string | null;
  warrantyUntil: string | null;
  notes: string | null;
}

export interface PlannedEmployee {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  employeeCode: string | null;
  startDate: string | null;
  /** The row this updates, or null when it creates somebody new. */
  existingId: string | null;
}

/** Discriminated on kind so a writer can never read the wrong array. */
export type ImportPlan =
  | { kind: 'assets'; report: ImportReport; rows: PlannedAsset[] }
  | { kind: 'employees'; report: ImportReport; rows: PlannedEmployee[] };

/** What /import/commit answers with — the summary step reads it. */
export interface ImportResult {
  kind: ImportKind;
  created: number;
  updated: number;
}
