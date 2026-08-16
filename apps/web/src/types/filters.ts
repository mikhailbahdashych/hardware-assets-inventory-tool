import type { AssetStatus } from '@inventory/shared';

/** The status pill row offers every status plus "All". */
export type StatusFilter = AssetStatus | 'all';

/** The asset list's two filters, both mirrored into the query string. */
export interface AssetFilters {
  status: StatusFilter;
  query: string;
}
