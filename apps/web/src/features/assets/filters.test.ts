import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSET_STATUSES, type WorkflowStatus } from '@inventory/shared';
import { assetStatusPills, parseStatusFilter } from './filters';

/** The workspace's statuses, as the page reads them from `useWorkflow`. */
const STATUSES: WorkflowStatus[] = DEFAULT_ASSET_STATUSES.map((status, sortOrder) => ({
  ...status,
  sortOrder,
}));

/** What `GET /assets` sends beside the page: three assets, two of them free. */
const COUNTS = { available: 1, in_repair: 1, assigned: 1 };

describe('assetStatusPills', () => {
  it('always lists All plus every status the workspace has, in its order', () => {
    const pills = assetStatusPills(COUNTS, STATUSES);
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
  });

  it('adds All up from the counts, so a chosen pill does not shrink it', () => {
    // `statusCounts` ignores the status filter, so All is still the whole
    // search — the payload's narrower `total` belongs to the footer and pager.
    expect(assetStatusPills(COUNTS, STATUSES)[0]!.count).toBe(3);
  });

  it('reads a status the payload never mentions as the zero it is', () => {
    expect(assetStatusPills(COUNTS, STATUSES).find((pill) => pill.value === 'retired')!.count).toBe(
      0,
    );
  });

  it('takes its labels and its order from the workspace, not from a code enum', () => {
    const renamed: WorkflowStatus[] = [
      { ...STATUSES[2]!, label: 'At the shop', sortOrder: 0 },
      { ...STATUSES[0]!, sortOrder: 1 },
    ];
    const pills = assetStatusPills(COUNTS, renamed);
    expect(pills.map((pill) => pill.label)).toEqual(['All', 'At the shop', 'Available']);
    expect(pills[1]!.count).toBe(1);
  });

  it('offers only All while the workflow is still loading', () => {
    expect(assetStatusPills(COUNTS, []).map((pill) => pill.value)).toEqual(['all']);
  });

  it('carries no number at all when no payload arrived', () => {
    // A read that is pending or has failed. Every filter is still offered —
    // "All 0 · Available 0" would be an inventory nobody counted.
    const pills = assetStatusPills(undefined, STATUSES);
    expect(pills.map((pill) => pill.value)).toContain('available');
    expect(pills.every((pill) => pill.count === undefined)).toBe(true);
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
