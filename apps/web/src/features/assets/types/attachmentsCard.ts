import type { Role } from '@inventory/shared';
import type { Attachment } from '@/types/api';

export interface AttachmentsCardProps {
  assetId: string;
  attachments: Attachment[];
  role: Role;
}
