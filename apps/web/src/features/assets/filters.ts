import type { WorkflowStatus } from '@inventory/shared';
import type { Asset } from '@/types/api';
import type { AssetFilters, StatusFilter } from '@/types/filters';

// Filtering is client-side over the full list the API returns, and the chosen
// values live in the URL (`/assets?status=&q=`) so a filtered view is
// shareable, survives a reload, and can be linked to from the dashboard.

/**
 * No `?status=` in the URL, or one this workspace has no status for, both mean
 * "unfiltered" — a link to a status somebody has since deleted shows the whole
 * inventory rather than an empty table nobody can explain.
 */
export function parseStatusFilter(value: string | null, statuses: WorkflowStatus[]): StatusFilter {
  return value !== null && statuses.some((status) => status.id === value) ? value : 'all';
}

/** The design's live filter: name, asset tag or serial, case-insensitive. */
export function filterAssets(assets: Asset[], { status, query }: AssetFilters): Asset[] {
  const needle = query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (status !== 'all' && asset.status !== status) return false;
    if (!needle) return true;
    // An asset without a serial matches nothing rather than everything.
    return [asset.name, asset.assetTag, asset.serialNumber ?? ''].some((field) =>
      field.toLowerCase().includes(needle),
    );
  });
}

/**
 * "All 13 · Available 2 · …" — every status the workspace has is always
 * offered, including the ones at zero, so the row does not reflow as inventory
 * changes. Labels and order come from the workflow; counts from the unfiltered
 * list.
 */
export function assetStatusPills(assets: Asset[], statuses: WorkflowStatus[]) {
  return [
    { value: 'all', label: 'All', count: assets.length },
    ...[...statuses]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((status) => ({
        value: status.id,
        label: status.label,
        count: assets.filter((asset) => asset.status === status.id).length,
      })),
  ];
}
