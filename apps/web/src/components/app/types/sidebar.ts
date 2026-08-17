import type { Member } from '@/types/api';

export interface SidebarProps {
  member: Member;
  orgName: string;
  onSignOut: () => void;
}
