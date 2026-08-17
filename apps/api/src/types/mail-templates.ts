// What each template needs. Every one carries `orgName` because a person may
// hold devices from more than one workspace, and `url` because a message that
// tells you something without a way to act on it wastes the reader's time.

export interface InviteMail {
  orgName: string;
  inviterName: string;
  role: string;
  url: string;
}

export interface ResetMail {
  orgName: string;
  url: string;
}

export interface AssignmentMail {
  orgName: string;
  assetName: string;
  assetTag: string;
  checkedOutAt: string;
  expectedReturnDate: string | null;
  url: string;
}

export interface CheckinMail {
  orgName: string;
  assetName: string;
  assetTag: string;
  returnedAt: string;
}

export interface WarrantyAlertMail {
  orgName: string;
  assets: { name: string; assetTag: string; warrantyUntil: string; daysLeft: number }[];
  url: string;
}

export interface ReturnReminderMail {
  orgName: string;
  holderName: string;
  assets: { name: string; assetTag: string; expectedReturnDate: string }[];
  url: string;
}

export interface DigestMail {
  orgName: string;
  assetCount: number;
  assignedCount: number;
  availableCount: number;
  /** Already rendered sentences — the same renderer the activity log uses. */
  recentActivity: string[];
  url: string;
}

// What the send helpers in `src/services/transactional.ts` are asked for: the
// template's own slots, minus `orgName` — which the caller never passes because
// the helper reads it from the workspace's settings — plus the address.

export type InviteMailRequest = { to: string } & Omit<InviteMail, 'orgName'>;

/** The reset template has only a URL, so this is spelled out rather than Omit-ed. */
export interface ResetMailRequest {
  to: string;
  url: string;
}

export type AssignmentMailRequest = { to: string } & Omit<AssignmentMail, 'orgName'>;

export type CheckinMailRequest = { to: string } & Omit<CheckinMail, 'orgName'>;
