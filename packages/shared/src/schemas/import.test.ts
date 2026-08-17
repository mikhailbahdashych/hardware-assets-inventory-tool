import { describe, expect, it } from 'vitest';
import {
  ASSET_IMPORT_COLUMNS,
  autoMatchColumns,
  csvTemplate,
  EMPLOYEE_IMPORT_COLUMNS,
  importColumns,
  matchEnumValue,
} from './import.js';
import { ASSET_CATEGORY_LABELS, DEFAULT_ASSET_STATUSES } from '../enums.js';
import type { WorkflowStatus } from '../types/workflow.js';

/**
 * The status vocabulary as the validator receives it: a runtime list read from
 * the workspace's own rows, not a label map compiled into the build.
 */
const SEEDED_STATUSES = DEFAULT_ASSET_STATUSES.map((status) => ({
  value: status.id,
  label: status.label,
}));

describe('the canonical column lists', () => {
  it('names the columns the design draws, in its order, marking the required ones', () => {
    expect(ASSET_IMPORT_COLUMNS.map((column) => column.header)).toEqual([
      'asset_tag',
      'name',
      'category',
      'serial_number',
      'status',
      'assigned_to_email',
      'purchase_date',
      'purchase_price',
      'currency',
      'supplier',
      'warranty_until',
      'notes',
    ]);
    expect(
      ASSET_IMPORT_COLUMNS.filter((column) => column.required).map((column) => column.header),
    ).toEqual(['asset_tag', 'name', 'category']);

    expect(EMPLOYEE_IMPORT_COLUMNS.map((column) => column.header)).toEqual([
      'first_name',
      'last_name',
      'email',
      'job_title',
      'department',
      'location',
      'employee_id',
      'start_date',
    ]);
    expect(
      EMPLOYEE_IMPORT_COLUMNS.filter((column) => column.required).map((column) => column.header),
    ).toEqual(['first_name', 'last_name', 'email']);
  });

  it('is reachable by kind', () => {
    expect(importColumns('assets')).toBe(ASSET_IMPORT_COLUMNS);
    expect(importColumns('employees')).toBe(EMPLOYEE_IMPORT_COLUMNS);
  });
});

describe('csvTemplate', () => {
  /** What a fresh workspace has; a real one passes its own rows. */
  const statuses: WorkflowStatus[] = DEFAULT_ASSET_STATUSES.map((status, sortOrder) => ({
    ...status,
    sortOrder,
  }));

  it('is the header row plus example rows, so a download is usable as-is', () => {
    const lines = csvTemplate('assets', statuses).trim().split('\n');
    expect(lines[0]).toBe(ASSET_IMPORT_COLUMNS.map((column) => column.header).join(','));
    expect(lines).toHaveLength(3);
    // An example row must survive its own round trip: the name has a comma.
    expect(lines[1]).toContain('"MacBook Pro 14"" M3"');
  });

  it('shows the workspace’s own status labels, never ones it would reject', () => {
    const renamed = statuses.map((status) =>
      status.isSystem ? { ...status, label: 'In use' } : { ...status, label: 'In stock' },
    );
    const lines = csvTemplate('assets', renamed).trim().split('\n');

    expect(lines[1]).toContain('In use');
    expect(lines[2]).toContain('In stock');
  });

  it('gives employees their own header row', () => {
    expect(csvTemplate('employees', statuses).split('\n')[0]).toBe(
      'first_name,last_name,email,job_title,department,location,employee_id,start_date',
    );
  });
});

describe('autoMatchColumns', () => {
  it('matches a header to its canonical column ignoring case, spaces and punctuation', () => {
    expect(autoMatchColumns('assets', ['Asset Tag', 'NAME', 'category '])).toEqual({
      asset_tag: 'Asset Tag',
      name: 'NAME',
      category: 'category ',
    });
  });

  it('leaves a column unmatched rather than guessing at it', () => {
    const matched = autoMatchColumns('employees', ['first_name', 'surname', 'e-mail']);
    expect(matched.first_name).toBe('first_name');
    expect(matched.email).toBe('e-mail');
    expect(matched.last_name).toBeUndefined();
  });

  it('takes the first header when a file repeats one', () => {
    expect(autoMatchColumns('employees', ['email', 'Email'])?.email).toBe('email');
  });
});

describe('matchEnumValue', () => {
  it('accepts the display label the export writes', () => {
    expect(matchEnumValue(SEEDED_STATUSES, 'In repair')).toBe('in_repair');
    expect(matchEnumValue(ASSET_CATEGORY_LABELS, 'Laptops')).toBe('laptops');
  });

  it('accepts the slug the database stores, and any casing of either', () => {
    expect(matchEnumValue(SEEDED_STATUSES, 'in_repair')).toBe('in_repair');
    expect(matchEnumValue(SEEDED_STATUSES, 'LOST/STOLEN')).toBe('lost_stolen');
    expect(matchEnumValue(ASSET_CATEGORY_LABELS, '  phones  ')).toBe('phones');
  });

  it('returns null for a value this build has no meaning for', () => {
    expect(matchEnumValue(SEEDED_STATUSES, 'On fire')).toBeNull();
    expect(matchEnumValue(SEEDED_STATUSES, '')).toBeNull();
  });

  /**
   * Statuses are rows an admin edits, so their vocabulary arrives at runtime
   * as a list rather than a label map compiled into the build.
   */
  it('reads a vocabulary handed to it as a list, the same way', () => {
    const workspace = [
      { value: 'on_loan', label: 'On loan' },
      { value: 'wiped_ready', label: 'Wiped & Ready' },
    ];
    expect(matchEnumValue(workspace, 'On loan')).toBe('on_loan');
    expect(matchEnumValue(workspace, 'on_loan')).toBe('on_loan');
    expect(matchEnumValue(workspace, 'WIPED & READY')).toBe('wiped_ready');
    expect(matchEnumValue(workspace, 'Available')).toBeNull();
    expect(matchEnumValue([], 'On loan')).toBeNull();
  });
});
