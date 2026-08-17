import type { Currency, LogRetention } from '@inventory/shared';

/**
 * The settings form's own state. Every field is what a control holds rather
 * than what a column holds — the lead time is the *text* of a number input,
 * because "" and "4x" are things a person can type and the form has to keep
 * them long enough to say so.
 */
export interface SettingsDraft {
  orgName: string;
  defaultCurrency: Currency;
  assetTagPrefix: string;
  warrantyLeadDays: string;
  logRetentionMonths: LogRetention;
  emailWarrantyAlerts: boolean;
  emailReturnReminders: boolean;
  emailInvites: boolean;
  emailWeeklyDigest: boolean;
  mfaRequired: boolean;
}
