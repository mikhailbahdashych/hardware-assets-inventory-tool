import type { MemberSummary } from '@/types/api';

export interface ChangeRoleModalProps {
  member: MemberSummary;
  /** The signed-in member's role — decides whether Admin is on offer. */
  viewerRole: string;
  onClose: () => void;
}
