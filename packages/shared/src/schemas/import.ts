import { z } from 'zod';
import type { EnumVocabulary, ImportColumn, VocabularyEntry } from '../types/import.js';
import type { WorkflowStatus } from '../types/workflow.js';
import { toCsv } from '../csv.js';

// The CSV vocabulary, shared by three places that must agree: the template the
// API serves, the auto-matcher in the import wizard's mapping step, and the
// validator that both /import/validate and /import/commit run.
//
// On the wire CSV speaks display labels ("In repair", "Laptops") because that
// is what a person editing a spreadsheet sees — and slugs too, so a file this
// app exported can be imported straight back.

export const IMPORT_KINDS = ['assets', 'employees'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  assets: 'Assets',
  employees: 'Employees',
};

const column = (header: string, required = false): ImportColumn => ({ header, required });

export const ASSET_IMPORT_COLUMNS: readonly ImportColumn[] = [
  column('asset_tag', true),
  column('name', true),
  column('category', true),
  column('serial_number'),
  column('status'),
  column('assigned_to_email'),
  column('purchase_date'),
  column('purchase_price'),
  column('currency'),
  column('supplier'),
  column('warranty_until'),
  column('notes'),
];

export const EMPLOYEE_IMPORT_COLUMNS: readonly ImportColumn[] = [
  column('first_name', true),
  column('last_name', true),
  column('email', true),
  column('job_title'),
  column('department'),
  column('location'),
  column('employee_id'),
  column('start_date'),
];

export function importColumns(kind: ImportKind): readonly ImportColumn[] {
  return kind === 'assets' ? ASSET_IMPORT_COLUMNS : EMPLOYEE_IMPORT_COLUMNS;
}

/** The design's behaviour note under the column chips, per kind. */
export const IMPORT_NOTES: Record<ImportKind, string> = {
  assets: 'Rows with an unknown assigned_to_email are imported as Unassigned.',
  employees: 'Existing employees are matched by email and updated, not duplicated.',
};

/**
 * The two example asset rows, with their status cells left to the caller: a
 * template that showed a status this workspace does not have would be a
 * template the app rejects. One row is held by somebody and one is not, which
 * is why the first takes the system status and the second takes a free one.
 */
const assetTemplateRows = (heldLabel: string, freeLabel: string): string[][] => [
  [
    'AST-0001',
    'MacBook Pro 14" M3',
    'Laptops',
    'C02XK1AZQ6L7',
    heldLabel,
    'maya.lindqvist@acme.io',
    '2023-03-12',
    '2340',
    'EUR',
    'Insight EMEA',
    '2026-09-12',
    'Engineering laptop',
  ],
  [
    'AST-0002',
    'Dell UltraSharp U2723QE',
    'Monitors',
    'CN0J2Y7',
    freeLabel,
    '',
    '2024-03-05',
    '589',
    'EUR',
    'Dell Direct',
    '2027-03-05',
    '',
  ],
];

const EMPLOYEE_TEMPLATE_ROWS: string[][] = [
  [
    'Maya',
    'Lindqvist',
    'maya.lindqvist@acme.io',
    'Senior Backend Engineer',
    'Engineering',
    'Stockholm',
    'EMP-0042',
    '2022-01-10',
  ],
  [
    'Daniel',
    'Okafor',
    'daniel.okafor@acme.io',
    'Platform Engineer',
    'Engineering',
    'Lagos (Remote)',
    'EMP-0057',
    '2023-05-02',
  ],
];

/**
 * The starter file the Data card offers. Built from the same column list the
 * validator reads, and — for assets — from the workspace's own statuses, so a
 * downloaded template can never be one the app rejects.
 *
 * `statuses` arrives in sort order. The first row shows a held asset, so it
 * takes whichever status the workspace calls its system one; the second shows
 * a free asset and takes the first status that is not.
 */
export function csvTemplate(kind: ImportKind, statuses: readonly WorkflowStatus[]): string {
  return toCsv(
    importColumns(kind).map((entry) => entry.header),
    kind === 'assets'
      ? assetTemplateRows(...exampleStatusLabels(statuses))
      : EMPLOYEE_TEMPLATE_ROWS,
  );
}

/**
 * The two labels the asset example rows show. Both always exist — `assigned`
 * cannot be deleted, and the workflow service refuses to leave a workspace
 * without an assignable status either — so a miss is a broken invariant and
 * says so rather than printing a template with a blank example.
 */
function exampleStatusLabels(statuses: readonly WorkflowStatus[]): [string, string] {
  const held = statuses.find((status) => status.isSystem);
  const free = statuses.find((status) => !status.isSystem);
  if (!held || !free) {
    throw new Error('The workspace has no status to write an example import row with.');
  }
  return [held.label, free.label];
}

/** "Asset Tag", "asset-tag" and " ASSET_TAG " are all the same column. */
const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Guesses which file header belongs to each canonical column. A column with no
 * confident match is left out rather than pointed at something plausible — the
 * mapping step exists so a person resolves those, and a wrong guess that
 * imports silently is worse than an empty select.
 */
export function autoMatchColumns(
  kind: ImportKind,
  headers: string[],
): Record<string, string | undefined> {
  const matched: Record<string, string | undefined> = {};
  for (const entry of importColumns(kind)) {
    matched[entry.header] = headers.find((header) => normalize(header) === normalize(entry.header));
  }
  return matched;
}

/**
 * Reads a vocabulary cell: the display label a spreadsheet shows, or the slug
 * the database stores, in any casing. Returns null when the vocabulary has no
 * meaning for the value — the caller turns that into a row error naming the
 * cell.
 *
 * The vocabulary is a **runtime** list as often as a compile-time map now.
 * Categories and currencies are still closed in code and pass their label map;
 * statuses are rows an admin edits, so the caller reads them from the database
 * and passes the list. Neither can be assumed by this function.
 */
export function matchEnumValue<T extends string>(
  vocabulary: EnumVocabulary<T>,
  value: string,
): T | null {
  const wanted = normalize(value);
  if (wanted === '') return null;
  for (const entry of entriesOf(vocabulary)) {
    if (normalize(entry.value) === wanted || normalize(entry.label) === wanted) return entry.value;
  }
  return null;
}

function entriesOf<T extends string>(vocabulary: EnumVocabulary<T>): readonly VocabularyEntry<T>[] {
  return Array.isArray(vocabulary)
    ? vocabulary
    : (Object.entries(vocabulary) as [T, string][]).map(([value, label]) => ({ value, label }));
}

/**
 * A row as the wizard sends it: canonical column header → cell text. The client
 * applies the column mapping, so the server only ever sees canonical keys and
 * never has to know what the file's own headers were called.
 */
const importRow = z.record(
  z.string(),
  // Bounded because every validator runs over these strings, and an
  // unbounded cell makes any per-character cost somebody else's outage.
  z.string().max(2000, 'That cell is too long to import.'),
);

export const importValidateInput = z.object({
  kind: z.enum(IMPORT_KINDS),
  rows: z.array(importRow).max(5000),
});
export type ImportValidateInput = z.infer<typeof importValidateInput>;

/** Commit takes the same payload and re-validates it — the client cannot skip. */
export const importCommitInput = importValidateInput;
export type ImportCommitInput = ImportValidateInput;
