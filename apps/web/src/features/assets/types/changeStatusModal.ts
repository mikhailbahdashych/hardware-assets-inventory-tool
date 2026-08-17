import type { Asset } from '@/types/api';

export interface ChangeStatusModalProps {
  asset: Asset;
  onClose: () => void;
}
