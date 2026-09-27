import type { WorkflowPayload } from '@inventory/shared';
import type { Asset } from '@/types/api';

export interface ChangeStatusModalProps {
  asset: Asset;
  /**
   * The asset page's own, already answered: it draws nothing past a pending or
   * failed `/workflow`, so the modal has no read of its own to wait for — and
   * no "not arrived yet" to mistake for a status with nowhere to go.
   */
  workflow: WorkflowPayload;
  onClose: () => void;
}
