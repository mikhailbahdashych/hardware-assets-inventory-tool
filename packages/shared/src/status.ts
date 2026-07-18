import { AssetStatus } from './enums';

/** Human-readable labels for asset statuses (used by web tables/chips and CSV export). */
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  [AssetStatus.AVAILABLE]: 'Available',
  [AssetStatus.ASSIGNED]: 'Assigned',
  [AssetStatus.IN_REPAIR]: 'In repair',
  [AssetStatus.RETIRED]: 'Retired',
  [AssetStatus.LOST]: 'Lost',
};

/** Material-palette-ish hex colors for status chips. */
export const ASSET_STATUS_COLORS: Record<AssetStatus, string> = {
  [AssetStatus.AVAILABLE]: '#2e7d32',
  [AssetStatus.ASSIGNED]: '#1565c0',
  [AssetStatus.IN_REPAIR]: '#ef6c00',
  [AssetStatus.RETIRED]: '#616161',
  [AssetStatus.LOST]: '#c62828',
};

/**
 * Statuses a user may set directly on an asset.
 * ASSIGNED is excluded: it is only ever set by the checkout flow.
 */
export const MANUAL_STATUS_TARGETS: readonly AssetStatus[] = [
  AssetStatus.AVAILABLE,
  AssetStatus.IN_REPAIR,
  AssetStatus.RETIRED,
  AssetStatus.LOST,
];
