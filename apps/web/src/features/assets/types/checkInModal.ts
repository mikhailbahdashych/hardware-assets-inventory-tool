import type { Asset } from '@/types/api';

/** Everything check-in needs to know: which asset, and who has it. */
export type CheckinSubject = Pick<Asset, 'id' | 'assetTag' | 'currentHolder'>;

export interface CheckInModalProps {
  asset: CheckinSubject;
  onClose: () => void;
}
