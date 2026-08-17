import { useState } from 'react';
import {
  CURRENCIES,
  CURRENCY_LABELS,
  LOG_RETENTION_LABELS,
  LOG_RETENTION_OPTIONS,
  WARRANTY_LEAD_DAY_LABELS,
  WARRANTY_LEAD_DAY_OPTIONS,
  type Currency,
  type LogRetention,
  type SettingsPatchInput,
  type WarrantyLeadDays,
} from '@inventory/shared';
import { useUpdateSettings } from '@/api/mutations';
import { useSettings } from '@/api/queries';
import { Field, Input, Select, Spinner, ToggleSwitch } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { OrgSettings } from '@/types/api';
import { DeleteWorkspaceModal } from './DeleteWorkspaceModal';
import styles from './Admin.module.css';

type EmailToggleKey =
  'emailWarrantyAlerts' | 'emailReturnReminders' | 'emailInvites' | 'emailWeeklyDigest';

/** One switch is one field; the return type is what keeps the key honest. */
function emailPatch(key: EmailToggleKey, checked: boolean): SettingsPatchInput {
  return { [key]: checked };
}

/** The design's four switches, in its order and its words. */
const EMAIL_TOGGLES = [
  {
    key: 'emailWarrantyAlerts',
    label: 'Warranty alerts',
    description: 'Notify admins before device warranties expire',
  },
  {
    key: 'emailReturnReminders',
    label: 'Return reminders',
    description: 'Remind holders when an asset is due back',
  },
  {
    key: 'emailInvites',
    label: 'Member invite emails',
    description: 'Send sign-up links when members are invited',
  },
  {
    key: 'emailWeeklyDigest',
    label: 'Weekly digest',
    description: 'Monday summary of changes for admins',
  },
] as const satisfies readonly { key: EmailToggleKey; label: string; description: string }[];

export function SettingsPanel() {
  const settings = useSettings();

  if (!settings.data) {
    return (
      <div className={styles.loading}>
        <Spinner size={18} />
      </div>
    );
  }
  // Keyed on the row so a save from elsewhere re-seeds the text inputs.
  return <SettingsForm key={settings.data.updatedAt} settings={settings.data} />;
}

/**
 * The design draws no Save button, so nothing waits for one: selects and
 * switches save the moment they change, and a text field saves when it is
 * left — and only if it actually changed.
 */
function SettingsForm({ settings }: { settings: OrgSettings }) {
  const [orgName, setOrgName] = useState(settings.orgName);
  const [assetTagPrefix, setAssetTagPrefix] = useState(settings.assetTagPrefix);
  const [deleting, setDeleting] = useState(false);

  const toast = useToast();
  const update = useUpdateSettings();

  const save = (patch: SettingsPatchInput) =>
    update.mutate(patch, {
      onSuccess: () => toast.show('Settings saved.', 'ok'),
      onError: (error) => toast.show(error.message, 'err'),
    });

  /** Nothing to send when a field is left exactly as it was found. */
  const saveIfChanged = (patch: SettingsPatchInput, current: string, stored: string) => {
    if (current.trim() === stored) return;
    save(patch);
  };

  return (
    <div className={styles.settings}>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Organization</h2>
        <div className={styles.grid}>
          <Field label="Company name">
            {(id) => (
              <Input
                id={id}
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                onBlur={() => saveIfChanged({ orgName: orgName.trim() }, orgName, settings.orgName)}
              />
            )}
          </Field>

          <Field label="Default currency">
            {(id) => (
              <Select
                id={id}
                value={settings.defaultCurrency}
                onChange={(event) => save({ defaultCurrency: event.target.value as Currency })}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Asset tag prefix">
            {(id) => (
              <Input
                id={id}
                className={styles.mono}
                value={assetTagPrefix}
                onChange={(event) => setAssetTagPrefix(event.target.value)}
                onBlur={() =>
                  saveIfChanged(
                    { assetTagPrefix: assetTagPrefix.trim() },
                    assetTagPrefix,
                    settings.assetTagPrefix,
                  )
                }
              />
            )}
          </Field>

          <Field label="Warranty alert lead time">
            {(id) => (
              <Select
                id={id}
                value={settings.warrantyLeadDays}
                onChange={(event) =>
                  save({ warrantyLeadDays: Number(event.target.value) as WarrantyLeadDays })
                }
              >
                {WARRANTY_LEAD_DAY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {WARRANTY_LEAD_DAY_LABELS[days]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitleTight}>Email notifications</h2>
        {EMAIL_TOGGLES.map((toggle) => (
          <div key={toggle.key} className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{toggle.label}</div>
              <div className={styles.rowHint}>{toggle.description}</div>
            </div>
            <ToggleSwitch
              label={toggle.label}
              checked={settings[toggle.key]}
              onChange={(checked) => save(emailPatch(toggle.key, checked))}
            />
          </div>
        ))}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Data</h2>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>CSV templates</div>
            <div className={styles.rowHint}>Starter files for bulk import</div>
          </div>
          <ComingWithImport label="assets.csv" />
          <ComingWithImport label="employees.csv" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Export all data</div>
            <div className={styles.rowHint}>Assets, people, history and settings as JSON</div>
          </div>
          <ComingWithImport label="Export" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Activity log retention</div>
            <div className={styles.rowHint}>Older events are pruned automatically</div>
          </div>
          <Select
            aria-label="Activity log retention"
            value={String(settings.logRetentionMonths)}
            onChange={(event) => save({ logRetentionMonths: readRetention(event.target.value) })}
          >
            {LOG_RETENTION_OPTIONS.map((months) => (
              <option key={String(months)} value={String(months)}>
                {LOG_RETENTION_LABELS[`${months}`]}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className={styles.danger}>
        <h2 className={styles.dangerTitle}>Danger zone</h2>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Delete workspace</div>
            <div className={styles.rowHint}>Permanently removes all data. Cannot be undone.</div>
          </div>
          <button type="button" className={styles.dangerButton} onClick={() => setDeleting(true)}>
            Delete…
          </button>
        </div>
      </section>

      {deleting && (
        <DeleteWorkspaceModal orgName={settings.orgName} onClose={() => setDeleting(false)} />
      )}
    </div>
  );
}

/**
 * The template downloads and the JSON export belong to the import/export PR.
 * They stay visible because the card's shape is part of the design, and they
 * say so rather than pretending to be links that go nowhere.
 */
function ComingWithImport({ label }: { label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={styles.rowAction}
      onClick={() => toast.show('CSV templates and the JSON export arrive with the import PR.')}
    >
      {label}
    </button>
  );
}

/** The select's option values are strings; "null" is the design's "Forever". */
function readRetention(value: string): LogRetention {
  const match = LOG_RETENTION_OPTIONS.find((months) => `${months}` === value);
  if (match === undefined) {
    throw new Error(`The retention select offered "${value}", which is not one of its options.`);
  }
  return match;
}
