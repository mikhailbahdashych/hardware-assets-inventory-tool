import type { MemberSummary } from '@/types/api';

export interface RemoveMemberModalProps {
  member: MemberSummary;
  onClose: () => void;
}
