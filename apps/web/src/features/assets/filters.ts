import { ASSET_STATUS_LABELS, ASSET_STATUSES, type AssetStatus } from '@inventory/shared';
import type { Asset } from '@/types/api';
import type { AssetFilters, StatusFilter } from '@/types/filters';

// Filtering is client-side over the full list the API returns, and the chosen
// values live in the URL (`/assets?status=&q=`) so a filtered view is
// shareable, survives a reload, and can be linked to from the dashboard.

/** No `?status=` in the URL, or one nobody recognises, both mean "unfiltered". */
export function parseStatusFilter(value: string | null): StatusFilter {
  return value !== null && (ASSET_STATUSES as readonly string[]).includes(value)
    ? (value as AssetStatus)
    : 'all';
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
 * "All 13 · Available 2 · …" — every status is always offered, including the
 * ones at zero, so the row does not reflow as inventory changes. Counts come
 * from the unfiltered list.
 */
export function assetStatusPills(assets: Asset[]) {
  return [
    { value: 'all' as const, label: 'All', count: assets.length },
    ...ASSET_STATUSES.map((status) => ({
      value: status,
      label: ASSET_STATUS_LABELS[status],
      count: assets.filter((asset) => asset.status === status).length,
    })),
  ];
}
