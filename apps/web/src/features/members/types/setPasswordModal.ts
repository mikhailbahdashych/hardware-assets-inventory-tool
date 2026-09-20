import type { MemberSummary } from '@/types/api';

export interface SetPasswordModalProps {
  member: MemberSummary;
  /** Called with the accepted password — the parent shows it exactly once. */
  onSet: (password: string) => void;
  onClose: () => void;
}
