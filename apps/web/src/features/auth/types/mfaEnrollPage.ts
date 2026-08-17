import type { Member } from '@/types/api';

export interface MfaEnrollPageProps {
  /** Named on the screen, so somebody signed in as the wrong person notices. */
  member: Member;
}
