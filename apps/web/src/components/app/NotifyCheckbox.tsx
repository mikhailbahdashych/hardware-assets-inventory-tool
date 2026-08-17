import { useMeta } from '@/api/queries';
import { Checkbox } from '@/components/ui';
import type { NotifyCheckboxProps } from './types/notifyCheckbox';

/**
 * The design's "notify" checkboxes, on the assign and check-in modals.
 *
 * An instance with no SMTP shows the row disabled and says why, rather than
 * hiding it: the toolbar keeps its shape, and somebody wondering why nobody got
 * an email finds the answer where they looked for the switch. `/meta` reports
 * whether this instance can send at all — that is instance metadata, not a
 * secret, and it says nothing about where mail goes.
 */
export function NotifyCheckbox({ checked, onChange, label }: NotifyCheckboxProps) {
  const meta = useMeta();
  // Metadata that has not arrived cannot promise email works.
  const canSend = meta.data?.smtpConfigured === true;

  return (
    <div>
      <Checkbox
        checked={canSend && checked}
        disabled={!canSend}
        onChange={(event) => onChange(event.target.checked)}
        label={label}
      />
      {!canSend && (
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>
          No SMTP is configured on this instance, so nothing is sent.
        </div>
      )}
    </div>
  );
}
