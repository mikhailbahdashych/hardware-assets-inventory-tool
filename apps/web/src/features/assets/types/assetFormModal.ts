import type { AssetCategory, Role } from '@inventory/shared';
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

export interface AssetFormModalProps {
  /** Absent for a create. */
  asset?: Asset;
  customFields?: CustomFieldValue[];
  role: Role;
  onClose: () => void;
  /** Where to go once the asset is gone; defaults to just closing. */
  onDeleted?: () => void;
}
