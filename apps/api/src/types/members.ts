import type { MemberStatus, Role } from '@inventory/shared';
import type { members } from '@/db/schema.js';

/**
 * A member exactly as the table stores them, password hash and preferences and
 * all. `request.member` is one of these (or null) on every request — see the
 * fastify augmentation in `src/plugins/session.ts`.
 */
export type MemberRow = typeof members.$inferSelect;

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
  /** Whether they hold a confirmed authenticator — the Members page shows it. */
  mfaEnrolled: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

/**
 * A fresh invitation link, returned in full and exactly once — only its hash is
 * stored. This is what `/members/:id/resend-invite` answers with; an invite
 * that also created the member answers with {@link InviteResult}.
 */
export interface InviteLink {
  inviteUrl: string;
}

/**
 * A password-reset link an admin issued, likewise returned once. The recovery
 * path on an instance with no SMTP is an admin copying this and handing it over.
 */
export interface ResetLink {
  resetUrl: string;
}

/** An invitation: the new member, and the link that works with or without SMTP. */
export interface InviteResult extends InviteLink {
  member: MemberSummary;
}
