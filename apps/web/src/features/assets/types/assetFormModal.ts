import type { AssetCategory, AssetStatus, Role } from '@inventory/shared';
import type { Asset, CustomFieldValue } from '@/types/api';

export interface AssetFormState {
  name: string;
  category: AssetCategory;
  status: AssetStatus;
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
