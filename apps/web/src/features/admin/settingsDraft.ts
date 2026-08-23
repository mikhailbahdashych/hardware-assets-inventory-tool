import type { SettingsPatchInput } from '@inventory/shared';
import type { OrgSettings } from '@/types/api';
import type { SettingsDraft } from './types/settingsDraft';

/**
 * What Save would send: only the fields that actually differ from the stored
 * row. An untouched form produces `{}`, which is what disables the button —
 * the diff *is* the dirty check, so the two cannot disagree.
 *
 * The two number fields — the lead time and the storage quota — are parsed
 * here rather than validated: text that is not a whole number is sent for the
 * schema to reject in its own words, which is how every other field in this
 * app reports a bad value.
 */
export function changedSettings(stored: OrgSettings, draft: SettingsDraft): SettingsPatchInput {
  const patch: SettingsPatchInput = {};

  const orgName = draft.orgName.trim();
  if (orgName !== stored.orgName) patch.orgName = orgName;

  const assetTagPrefix = draft.assetTagPrefix.trim().toUpperCase();
  if (assetTagPrefix !== stored.assetTagPrefix) patch.assetTagPrefix = assetTagPrefix;

  if (draft.defaultCurrency !== stored.defaultCurrency) {
    patch.defaultCurrency = draft.defaultCurrency;
  }
  if (draft.logRetentionMonths !== stored.logRetentionMonths) {
    patch.logRetentionMonths = draft.logRetentionMonths;
  }

  const leadText = draft.warrantyLeadDays.trim();
  if (leadText !== String(stored.warrantyLeadDays)) {
    patch.warrantyLeadDays = readNumber(leadText);
  }

  const quotaText = draft.uploadQuotaMb.trim();
  if (quotaText !== String(stored.uploadQuotaMb)) {
    patch.uploadQuotaMb = readNumber(quotaText);
  }

  for (const key of [
    'emailWarrantyAlerts',
    'emailReturnReminders',
    'emailInvites',
    'emailWeeklyDigest',
    'mfaRequired',
  ] as const) {
    if (draft[key] !== stored[key]) patch[key] = draft[key];
  }

  return patch;
}

/**
 * A number input's text as the schema should judge it. An empty or unparseable
 * field is still a change, so Save stays enabled and the server names what is
 * wrong instead of the button going quiet: -1 is outside every bound this form
 * has, and "4.5" is passed through as itself so it is reported as a fraction
 * rather than as a missing number.
 */
function readNumber(text: string): number {
  const value = Number(text);
  return text === '' || Number.isNaN(value) ? -1 : value;
}
