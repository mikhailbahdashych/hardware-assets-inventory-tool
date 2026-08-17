import { useState } from 'react';
import {
  CURRENCIES,
  CURRENCY_LABELS,
  LOG_RETENTION_LABELS,
  LOG_RETENTION_OPTIONS,
  MAX_WARRANTY_LEAD_DAYS,
  MIN_WARRANTY_LEAD_DAYS,
  type Currency,
  type LogRetention,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useUpdateSettings } from '@/api/mutations';
import { useMeta, useSettings } from '@/api/queries';
import { Button, Dropdown, Field, Input, Spinner, ToggleSwitch } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { OrgSettings } from '@/types/api';
import { DeleteWorkspaceModal } from './DeleteWorkspaceModal';
import { changedSettings } from './settingsDraft';
import type { SettingsDraft } from './types/settingsDraft';
import type { EmailToggleKey, SettingsFormProps } from './types/settingsPanel';
import styles from './Admin.module.css';

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
  // Keyed on the row so a save from elsewhere re-seeds the whole form.
  return <SettingsForm key={settings.data.updatedAt} settings={settings.data} />;
}

/**
 * One form, one Save. Everything is edited locally and written together when
 * the button is pressed, so nothing reaches the server as a side effect of
 * touching a control and a half-considered change can be abandoned by leaving.
 *
 * The design draws no Save button; this is a deliberate departure, and
 * apps/web/CLAUDE.md says why at length. The short version: saving on blur
 * meant a stray keystroke in "Company name" renamed the workspace for
 * everybody, with no way back.
 */
function SettingsForm({ settings }: SettingsFormProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [deleting, setDeleting] = useState(false);

  const toast = useToast();
  const update = useUpdateSettings();
  const meta = useMeta();
  // Metadata that has not arrived cannot promise email works.
  const canSendEmail = meta.data?.smtpConfigured === true;
  const errors = fieldErrors(update.error);

  // The diff *is* the dirty check, so the button and the payload cannot
  // disagree about whether there is anything to save.
  const patch = changedSettings(settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className={styles.settings}>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Organization</h2>
        <div className={styles.grid}>
          <Field label="Company name" error={errors.orgName}>
            {(id) => (
              <Input
                id={id}
                value={draft.orgName}
                onChange={(event) => set('orgName', event.target.value)}
              />
            )}
          </Field>

          <Field label="Default currency">
            {(id) => (
              <Dropdown
                id={id}
                value={draft.defaultCurrency}
                options={CURRENCIES.map((currency) => ({
                  value: currency,
                  label: CURRENCY_LABELS[currency],
                }))}
                onChange={(currency: Currency) => set('defaultCurrency', currency)}
              />
            )}
          </Field>

          <Field label="Asset tag prefix" error={errors.assetTagPrefix}>
            {(id) => (
              <Input
                id={id}
                mono
                value={draft.assetTagPrefix}
                onChange={(event) => set('assetTagPrefix', event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Warranty alert lead time"
            hint={`Any number from ${MIN_WARRANTY_LEAD_DAYS} to ${MAX_WARRANTY_LEAD_DAYS}`}
            error={errors.warrantyLeadDays}
          >
            {(id) => (
              <div className={styles.suffixed}>
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={MIN_WARRANTY_LEAD_DAYS}
                  max={MAX_WARRANTY_LEAD_DAYS}
                  value={draft.warrantyLeadDays}
                  onChange={(event) => set('warrantyLeadDays', event.target.value)}
                />
                <span className={styles.suffix}>days before expiry</span>
              </div>
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
              <div className={styles.rowHint}>
                {/* The switch still stores a preference without SMTP; it just
                    cannot act on one, and saying so beats a dead control. */}
                {canSendEmail ? toggle.description : 'SMTP is not configured on this instance'}
              </div>
            </div>
            <ToggleSwitch
              label={toggle.label}
              disabled={!canSendEmail}
              checked={draft[toggle.key]}
              onChange={(checked) => set(toggle.key, checked)}
            />
          </div>
        ))}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitleData}>Data</h2>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>CSV templates</div>
            <div className={styles.rowHint}>Starter files for bulk import</div>
          </div>
          {/* Plain links: the browser downloads the attachment itself and the
              session cookie rides along, so there is no blob to build. */}
          <a className={styles.rowAction} href="/api/v1/import/template?kind=assets" download>
            assets.csv
          </a>
          <a className={styles.rowAction} href="/api/v1/import/template?kind=employees" download>
            employees.csv
          </a>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Export all data</div>
            <div className={styles.rowHint}>
              Assets, people, history and settings as JSON · a reporting format, not a backup
            </div>
          </div>
          <a className={styles.rowAction} href="/api/v1/export" download>
            Export
          </a>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Activity log retention</div>
            <div className={styles.rowHint}>Older events are pruned automatically</div>
          </div>
          <div className={styles.rowControl}>
            <Dropdown
              aria-label="Activity log retention"
              value={`${draft.logRetentionMonths}`}
              options={LOG_RETENTION_OPTIONS.map((months) => ({
                value: `${months}`,
                label: LOG_RETENTION_LABELS[`${months}`],
              }))}
              onChange={(value) => set('logRetentionMonths', readRetention(value))}
            />
          </div>
        </div>
      </section>

      {/* Sticky: the fields it saves are taller than a screen, and a Save
          button you have to scroll to find is a Save button people miss. */}
      <div className={styles.actions}>
        <span className={styles.actionsNote}>
          {dirty ? 'Unsaved changes' : 'Everything here is saved'}
        </span>
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(toDraft(settings))}>
          Discard
        </Button>
        <Button
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate(patch, {
              onSuccess: () => toast.show('Settings saved.', 'ok'),
              onError: (error) => toast.show(error.message, 'err'),
            })
          }
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

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

/** The stored row as the form edits it: a number becomes an input's text. */
function toDraft(settings: OrgSettings): SettingsDraft {
  return {
    orgName: settings.orgName,
    defaultCurrency: settings.defaultCurrency,
    assetTagPrefix: settings.assetTagPrefix,
    warrantyLeadDays: String(settings.warrantyLeadDays),
    logRetentionMonths: settings.logRetentionMonths,
    emailWarrantyAlerts: settings.emailWarrantyAlerts,
    emailReturnReminders: settings.emailReturnReminders,
    emailInvites: settings.emailInvites,
    emailWeeklyDigest: settings.emailWeeklyDigest,
  };
}

/** The dropdown's values are strings; "null" is the design's "Forever". */
function readRetention(value: string): LogRetention {
  const match = LOG_RETENTION_OPTIONS.find((months) => `${months}` === value);
  if (match === undefined) {
    throw new Error(`The retention control offered "${value}", which is not one of its options.`);
  }
  return match;
}
