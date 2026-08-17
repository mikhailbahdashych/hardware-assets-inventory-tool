import type { Member } from '@/types/api';

export interface CustomizeWidgetsModalProps {
  member: Member;
  onClose: () => void;
}
