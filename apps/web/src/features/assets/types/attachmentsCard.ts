import type { Action } from '@inventory/shared';
import type { Attachment } from '@/types/api';

export interface AttachmentsCardProps {
  assetId: string;
  attachments: Attachment[];
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
}
