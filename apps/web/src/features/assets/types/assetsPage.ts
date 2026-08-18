import type { Action } from '@inventory/shared';
import type { StatusFilter } from '@/types/filters';

/** One filter change on the asset list; either key may be set on its own. */
export interface AssetFilterUpdate {
  status?: StatusFilter;
  q?: string;
}

export interface AssetsPageProps {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
}
