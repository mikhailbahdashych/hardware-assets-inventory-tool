import type { MemberSummary } from '@/types/api';

export interface ChangeRoleModalProps {
  member: MemberSummary;
  onClose: () => void;
}
