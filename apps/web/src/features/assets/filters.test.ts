import { describe, expect, it } from 'vitest';
import type { Asset } from '@/types/api';
import { assetStatusPills, filterAssets, parseStatusFilter } from './filters';

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
  it('always lists All plus every status, counting the unfiltered list', () => {
    const pills = assetStatusPills(ASSETS);
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

  it('uses the labels from the design', () => {
    const pills = assetStatusPills([]);
    expect(pills.map((pill) => pill.label)).toContain('Lost/Stolen');
    expect(pills.map((pill) => pill.label)).toContain('In repair');
  });
});

describe('parseStatusFilter', () => {
  it('accepts a known status slug and falls back to "all"', () => {
    expect(parseStatusFilter('in_repair')).toBe('in_repair');
    expect(parseStatusFilter('all')).toBe('all');
    expect(parseStatusFilter(null)).toBe('all');
    expect(parseStatusFilter('nonsense')).toBe('all');
  });
});
