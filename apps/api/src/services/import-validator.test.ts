import { DEFAULT_ASSET_STATUSES, type WorkflowStatus } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import type { ImportContext } from '@/types/import.js';
import { planImport } from './import-validator.js';

/** The seeded workflow, which is what an unedited workspace hands the planner. */
const DEFAULT_STATUSES: WorkflowStatus[] = DEFAULT_ASSET_STATUSES.map((status, sortOrder) => ({
  ...status,
  sortOrder,
}));

const context = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  existingAssetTags: new Set<string>(),
  employeeIdByEmail: new Map<string, string>(),
  employeeStatusById: new Map<string, string>(),
  statuses: DEFAULT_STATUSES,
  ...overrides,
});

const assetRow = (overrides: Record<string, string> = {}) => ({
  asset_tag: 'AST-0100',
  name: 'MacBook Pro 14"',
  category: 'Laptops',
  ...overrides,
});

const employeeRow = (overrides: Record<string, string> = {}) => ({
  first_name: 'Maya',
  last_name: 'Lindqvist',
  email: 'Maya.Lindqvist@Acme.io',
  ...overrides,
});

function planAssets(rows: Record<string, string>[], ctx = context()) {
  const plan = planImport({ kind: 'assets', rows }, ctx);
  if (plan.kind !== 'assets') throw new Error('expected an asset plan');
  return plan;
}

function planEmployees(rows: Record<string, string>[], ctx = context()) {
  const plan = planImport({ kind: 'employees', rows }, ctx);
  if (plan.kind !== 'employees') throw new Error('expected an employee plan');
  return plan;
}

describe('planning an asset import', () => {
  it('reads a full row into the shape the writer needs', () => {
    const employees = new Map([['maya.lindqvist@acme.io', 'emp-1']]);
    const plan = planAssets(
      [
        assetRow({
          serial_number: 'C02XK1AZQ6L7',
          status: 'Assigned',
          assigned_to_email: 'Maya.Lindqvist@Acme.io',
          purchase_date: '2023-03-12',
          purchase_price: '2,340.00',
          currency: 'EUR',
          supplier: 'Insight EMEA',
          warranty_until: '2026-09-12',
          notes: 'Engineering laptop',
        }),
      ],
      context({
        employeeIdByEmail: employees,
        employeeStatusById: new Map([['emp-1', 'active']]),
      }),
    );

    expect(plan.report).toMatchObject({ totalRows: 1, validCount: 1, createCount: 1 });
    expect(plan.report.errors).toEqual([]);
    expect(plan.rows[0]).toEqual({
      rowNumber: 2,
      assetTag: 'AST-0100',
      name: 'MacBook Pro 14"',
      category: 'laptops',
      serialNumber: 'C02XK1AZQ6L7',
      status: 'assigned',
      assignedToEmployeeId: 'emp-1',
      holderName: null,
      purchaseDate: '2023-03-12',
      purchasePriceCents: 234000,
      currency: 'EUR',
      supplier: 'Insight EMEA',
      warrantyUntil: '2026-09-12',
      notes: 'Engineering laptop',
    });
  });

  it('numbers rows the way a spreadsheet does, header included', () => {
    const plan = planAssets([assetRow({ name: '' }), assetRow({ asset_tag: 'AST-0101' })]);
    expect(plan.report.errors[0]!.row).toBe(2);
  });

  it('leaves every optional column NULL when it is blank or absent', () => {
    const plan = planAssets([assetRow({ serial_number: '  ', notes: '' })]);
    expect(plan.rows[0]).toMatchObject({
      serialNumber: null,
      status: 'available',
      assignedToEmployeeId: null,
      purchaseDate: null,
      purchasePriceCents: null,
      // NULL currency means "the organization's default" everywhere else in the
      // app — the asset form has no currency select either — so a blank cell is
      // the normal case and not worth a warning.
      currency: null,
      supplier: null,
      warrantyUntil: null,
      notes: null,
    });
    expect(plan.report.warnings).toEqual([]);
  });

  it.each([
    ['a missing required cell', assetRow({ asset_tag: '' }), 'asset_tag'],
    ['an unknown category', assetRow({ category: 'Hovercraft' }), 'category'],
    ['an unknown status', assetRow({ status: 'On fire' }), 'status'],
    ['a date that is not a date', assetRow({ purchase_date: '12/03/2023' }), 'purchase_date'],
    [
      'a price that is not a number',
      assetRow({ purchase_price: 'about two grand' }),
      'purchase_price',
    ],
    ['an unknown currency', assetRow({ currency: 'ZWD' }), 'currency'],
  ])('refuses %s', (_case, row, column) => {
    const plan = planAssets([row]);
    expect(plan.report.errors).toHaveLength(1);
    expect(plan.report.errors[0]).toMatchObject({ row: 2, column });
    expect(plan.report.validCount).toBe(0);
    expect(plan.rows).toEqual([]);
  });

  it('reads a status cell as the workspace’s own vocabulary, label or slug', () => {
    const onLoan: WorkflowStatus = {
      id: 'on_loan',
      label: 'On loan',
      color: 'info',
      isSystem: false,
      assignableFrom: false,
      checkinTarget: true,
      sortOrder: 6,
    };
    const ctx = context({ statuses: [...DEFAULT_STATUSES, onLoan] });

    // Both spellings of a seeded status, and both of one an admin added.
    for (const cell of ['In repair', 'in_repair', 'IN REPAIR']) {
      expect(planAssets([assetRow({ status: cell })], ctx).rows[0]).toMatchObject({
        status: 'in_repair',
      });
    }
    for (const cell of ['On loan', 'on_loan']) {
      expect(planAssets([assetRow({ status: cell })], ctx).rows[0]).toMatchObject({
        status: 'on_loan',
      });
    }
  });

  it('refuses a status this workspace has deleted, naming the cell', () => {
    const withoutRepair = DEFAULT_STATUSES.filter((status) => status.id !== 'in_repair');
    const plan = planAssets(
      [assetRow({ status: 'In repair' })],
      context({ statuses: withoutRepair }),
    );

    expect(plan.report.errors).toEqual([
      { row: 2, column: 'status', message: expect.stringContaining('In repair') },
    ]);
    expect(plan.rows).toEqual([]);
  });

  it('starts a row with no status in the first status the workflow lists', () => {
    const reordered = [...DEFAULT_STATUSES]
      .filter((status) => status.id !== 'available')
      .map((status, sortOrder) => ({ ...status, sortOrder }));
    const plan = planAssets([assetRow()], context({ statuses: reordered }));

    expect(plan.rows[0]).toMatchObject({ status: reordered[0]!.id });
  });

  it('refuses a tag the file uses twice, naming the second row', () => {
    const plan = planAssets([assetRow(), assetRow({ name: 'Another one' })]);
    expect(plan.report.errors).toEqual([
      { row: 3, column: 'asset_tag', message: expect.stringContaining('twice') },
    ]);
    expect(plan.report.createCount).toBe(1);
  });

  it('refuses a tag the inventory already has — assets are only ever created', () => {
    const plan = planAssets([assetRow()], context({ existingAssetTags: new Set(['AST-0100']) }));
    expect(plan.report.errors[0]).toMatchObject({ column: 'asset_tag' });
    expect(plan.report.errors[0]!.message).toMatch(/already/i);
  });

  it('imports an asset as unassigned when its assignee is unknown, and says so', () => {
    const plan = planAssets([
      assetRow({ status: 'Assigned', assigned_to_email: 'nobody@acme.io' }),
    ]);
    expect(plan.report.errors).toEqual([]);
    expect(plan.report.warnings[0]).toMatchObject({ row: 2, column: 'assigned_to_email' });
    expect(plan.rows[0]).toMatchObject({ status: 'available', assignedToEmployeeId: null });
  });

  it('will not hand an asset to somebody who is offboarding', () => {
    const plan = planAssets(
      [assetRow({ status: 'Assigned', assigned_to_email: 'liam@acme.io' })],
      context({
        employeeIdByEmail: new Map([['liam@acme.io', 'emp-9']]),
        employeeStatusById: new Map([['emp-9', 'offboarding']]),
      }),
    );
    expect(plan.report.errors[0]).toMatchObject({ row: 2, column: 'assigned_to_email' });
    expect(plan.report.errors[0]!.message).toMatch(/offboarding/i);
  });

  it('ignores an assignee on a row that is not assigned, and says so', () => {
    const plan = planAssets(
      [assetRow({ status: 'In repair', assigned_to_email: 'maya@acme.io' })],
      context({
        employeeIdByEmail: new Map([['maya@acme.io', 'emp-1']]),
        employeeStatusById: new Map([['emp-1', 'active']]),
      }),
    );
    expect(plan.report.errors).toEqual([]);
    expect(plan.report.warnings[0]!.message).toMatch(/ignored/i);
    expect(plan.rows[0]).toMatchObject({ status: 'in_repair', assignedToEmployeeId: null });
  });

  it('requires an assignee for a row that says Assigned', () => {
    const plan = planAssets([assetRow({ status: 'Assigned' })]);
    expect(plan.report.warnings[0]).toMatchObject({ column: 'assigned_to_email' });
    expect(plan.rows[0]).toMatchObject({ status: 'available' });
  });

  it('keeps counting after a bad row, so one typo does not hide the rest', () => {
    const plan = planAssets([
      assetRow({ asset_tag: 'AST-1', category: 'Nope' }),
      assetRow({ asset_tag: 'AST-2' }),
      assetRow({ asset_tag: 'AST-3', purchase_date: 'yesterday' }),
      assetRow({ asset_tag: 'AST-4' }),
    ]);
    expect(plan.report).toMatchObject({ totalRows: 4, validCount: 2, createCount: 2 });
    expect(plan.report.errors.map((error) => error.row)).toEqual([2, 4]);
  });

  it('caps the error list so a wholly wrong file cannot flood the screen', () => {
    const rows = Array.from({ length: 150 }, (_, index) =>
      assetRow({ asset_tag: `AST-${index}`, category: '' }),
    );
    const plan = planAssets(rows);
    expect(plan.report.errors).toHaveLength(100);
    expect(plan.report.errorsTruncated).toBe(true);
    // The count is still the truth, even though the list is not all of it.
    expect(plan.report.validCount).toBe(0);
  });
});

describe('planning an employee import', () => {
  it('lowercases the email and reads the optional columns', () => {
    const plan = planEmployees([
      employeeRow({
        job_title: 'Product Designer',
        department: 'Design',
        location: 'Stockholm',
        employee_id: 'EMP-0042',
        start_date: '2022-01-10',
      }),
    ]);
    expect(plan.rows[0]).toEqual({
      rowNumber: 2,
      firstName: 'Maya',
      lastName: 'Lindqvist',
      email: 'maya.lindqvist@acme.io',
      jobTitle: 'Product Designer',
      department: 'Design',
      location: 'Stockholm',
      employeeCode: 'EMP-0042',
      startDate: '2022-01-10',
      existingId: null,
    });
    expect(plan.report).toMatchObject({ createCount: 1, updateCount: 0 });
  });

  it('updates rather than duplicates somebody the workspace already knows', () => {
    const plan = planEmployees(
      [employeeRow()],
      context({ employeeIdByEmail: new Map([['maya.lindqvist@acme.io', 'emp-1']]) }),
    );
    expect(plan.rows[0]!.existingId).toBe('emp-1');
    expect(plan.report).toMatchObject({ createCount: 0, updateCount: 1, validCount: 1 });
  });

  it.each([
    ['a missing name', employeeRow({ first_name: ' ' }), 'first_name'],
    ['an address that is not an email', employeeRow({ email: 'maya at acme' }), 'email'],
    ['a start date that is not a date', employeeRow({ start_date: '10.01.2022' }), 'start_date'],
  ])('refuses %s', (_case, row, column) => {
    const plan = planEmployees([row]);
    expect(plan.report.errors[0]).toMatchObject({ row: 2, column });
  });

  it('refuses an email the file uses twice', () => {
    const plan = planEmployees([employeeRow(), employeeRow({ first_name: 'Maja' })]);
    expect(plan.report.errors).toEqual([
      { row: 3, column: 'email', message: expect.stringContaining('twice') },
    ]);
  });
});

describe('an empty file', () => {
  it('is not an error, and has nothing to do', () => {
    const plan = planAssets([]);
    expect(plan.report).toMatchObject({ totalRows: 0, validCount: 0, createCount: 0 });
    expect(plan.report.errors).toEqual([]);
  });
});
