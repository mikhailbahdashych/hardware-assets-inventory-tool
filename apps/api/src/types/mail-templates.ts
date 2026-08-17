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
