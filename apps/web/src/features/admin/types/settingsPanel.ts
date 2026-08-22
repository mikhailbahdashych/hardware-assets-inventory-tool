import type { OrgSettings } from '@/types/api';
import type { SettingsDraft } from './settingsDraft';

/** Derived from the draft, so the switch list cannot drift from the form's own fields. */
export type EmailToggleKey = Extract<keyof SettingsDraft, `email${string}`>;

export interface SettingsFormProps {
  settings: OrgSettings;
  /** What the attachments already take, against the quota the form edits. */
  storageUsedBytes: number;
}
