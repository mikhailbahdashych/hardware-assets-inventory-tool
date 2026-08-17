import type { Role } from '@inventory/shared';
import type { MemberSummary } from '@/types/api';

/** Which of the page's own modals is open, and about whom. Inviting is not
 *  here: it carries no subject and the command palette opens it too, so it
 *  belongs to ModalProvider. */
export type MembersDialog =
  | { kind: 'role'; member: MemberSummary }
  | { kind: 'remove'; member: MemberSummary }
  | { kind: 'link'; title: string; subtitle: string; label: string; url: string };

export interface MembersPageProps {
  role: Role;
  memberId: string;
}
