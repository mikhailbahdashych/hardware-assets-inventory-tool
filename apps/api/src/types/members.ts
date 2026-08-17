import type { MemberStatus, Role } from '@inventory/shared';

/** The employee record a member is linked to, named so the list need not join. */
export interface LinkedEmployee {
  id: string;
  displayName: string;
}

/**
 * A member as the Members page reads them. Deliberately not `serializeMember`
 * (lib/serialize.ts): that one is the signed-in member's own view and carries
 * their theme, density and widget preferences, which are nobody else's.
 */
export interface MemberSummary {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: MemberStatus;
  employeeId: string | null;
  linkedEmployee: LinkedEmployee | null;
  lastActiveAt: string | null;
  createdAt: string;
}

/** An invitation: the new member, and the link that works with or without SMTP. */
export interface InviteResult {
  member: MemberSummary;
  inviteUrl: string;
}
