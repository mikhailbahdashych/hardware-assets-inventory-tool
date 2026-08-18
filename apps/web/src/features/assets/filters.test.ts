import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSET_STATUSES, type WorkflowStatus } from '@inventory/shared';
import type { Asset } from '@/types/api';
import { assetStatusPills, filterAssets, parseStatusFilter } from './filters';

/** The workspace's statuses, as the page reads them from `useWorkflow`. */
const STATUSES: WorkflowStatus[] = DEFAULT_ASSET_STATUSES.map((status, sortOrder) => ({
  ...status,
  sortOrder,
}));

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: overrides.assetTag ?? 'a1',
    assetTag: 'AST-0001',
    name: 'MacBook Pro 14"',
    category: 'laptops',
    status: 'available',
    model: null,
    serialNumber: null,
    purchaseDate: null,
    purchasePriceCents: null,
    currency: null,
    supplier: null,
    warrantyUntil: null,
    notes: null,
    currentHolder: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ASSETS = [
  asset({ assetTag: 'AST-0001', name: 'MacBook Pro 14"', serialNumber: 'C02XK1AZQ6L7' }),
  asset({ assetTag: 'AST-0002', name: 'Dell U2723QE', category: 'monitors', status: 'in_repair' }),
  asset({ assetTag: 'AST-0003', name: 'iPhone 15', category: 'phones', status: 'assigned' }),
];

describe('filterAssets', () => {
  it('returns everything for the default filter', () => {
    expect(filterAssets(ASSETS, { status: 'all', query: '' })).toHaveLength(3);
  });

  it('narrows to one status', () => {
    expect(filterAssets(ASSETS, { status: 'in_repair', query: '' }).map((a) => a.assetTag)).toEqual(
      ['AST-0002'],
    );
  });

  it('matches name, tag or serial, case-insensitively', () => {
    expect(filterAssets(ASSETS, { status: 'all', query: 'macbook' })).toHaveLength(1);
    expect(filterAssets(ASSETS, { status: 'all', query: 'ast-0002' })).toHaveLength(1);
    expect(filterAssets(ASSETS, { status: 'all', query: 'c02xk1' })).toHaveLength(1);
    expect(filterAssets(ASSETS, { status: 'all', query: 'nothing here' })).toHaveLength(0);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(filterAssets(ASSETS, { status: 'all', query: '  iphone  ' })).toHaveLength(1);
  });

  it('applies status and query together', () => {
    expect(filterAssets(ASSETS, { status: 'assigned', query: 'macbook' })).toHaveLength(0);
  });
});

describe('assetStatusPills', () => {
  it('always lists All plus every status the workspace has, in its order', () => {
    const pills = assetStatusPills(ASSETS, STATUSES);
    expect(pills.map((pill) => pill.value)).toEqual([
      'all',
      'available',
      'assigned',
      'in_repair',
      'ordered',
      'retired',
      'lost_stolen',
    ]);
    expect(pills.find((pill) => pill.value === 'all')!.count).toBe(3);
    expect(pills.find((pill) => pill.value === 'available')!.count).toBe(1);
    expect(pills.find((pill) => pill.value === 'retired')!.count).toBe(0);
  });

  it('takes its labels and its order from the workspace, not from a code enum', () => {
    const renamed: WorkflowStatus[] = [
      { ...STATUSES[2]!, label: 'At the shop', sortOrder: 0 },
      { ...STATUSES[0]!, sortOrder: 1 },
    ];
    const pills = assetStatusPills(ASSETS, renamed);
    expect(pills.map((pill) => pill.label)).toEqual(['All', 'At the shop', 'Available']);
    expect(pills[1]!.count).toBe(1);
  });

  it('offers only All while the workflow is still loading', () => {
    expect(assetStatusPills(ASSETS, []).map((pill) => pill.value)).toEqual(['all']);
  });
});

describe('parseStatusFilter', () => {
  it('accepts a status this workspace has and falls back to "all"', () => {
    expect(parseStatusFilter('in_repair', STATUSES)).toBe('in_repair');
    expect(parseStatusFilter('all', STATUSES)).toBe('all');
    expect(parseStatusFilter(null, STATUSES)).toBe('all');
    expect(parseStatusFilter('nonsense', STATUSES)).toBe('all');
  });

  it('accepts a status only this workspace has', () => {
    const withCustom = [
      ...STATUSES,
      {
        id: 'on_loan',
        label: 'On loan',
        color: 'info' as const,
        isSystem: false,
        assignableFrom: false,
        checkinTarget: false,
        sortOrder: 6,
      },
    ];
    expect(parseStatusFilter('on_loan', withCustom)).toBe('on_loan');
    expect(parseStatusFilter('on_loan', STATUSES)).toBe('all');
  });
});
