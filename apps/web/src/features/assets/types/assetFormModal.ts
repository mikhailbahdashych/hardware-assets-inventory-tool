import type { Action, AssetCategory } from '@inventory/shared';
import type { Asset, CustomFieldValue } from '@/types/api';

export interface AssetFormState {
  name: string;
  category: AssetCategory;
  /** A status id, or `''` while nobody has chosen and the workflow is loading. */
  status: string;
  assetTag: string;
  serialNumber: string;
  model: string;
  assignedToEmployeeId: string;
  checkoutDate: string;
  purchaseDate: string;
  price: string;
  supplier: string;
  warrantyUntil: string;
  notes: string;
  customValues: Record<string, string>;
}

/**
 * A create knows nothing yet; an edit knows the asset **and** its custom-field
 * values. A union rather than two optional props, because an edit handed no
 * values would open with every custom field blank — and save that blank over
 * what is stored.
 */
export type AssetFormModalProps = {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
  onClose: () => void;
  /** Where to go once the asset is gone; defaults to just closing. */
  onDeleted?: () => void;
} & (
  | { asset?: undefined; customFields?: undefined }
  | { asset: Asset; customFields: CustomFieldValue[] }
);
