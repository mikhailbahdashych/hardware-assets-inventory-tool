import { useState } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import styles from './Members.module.css';

/**
 * An invitation or reset link, shown once. The raw token exists nowhere else —
 * the database keeps only its hash — so the link is rendered as selectable
 * text and copying is the convenience on top. Clipboard access needs a secure
 * context, which a self-hosted instance on plain http is not.
 */
export function CopyLinkModal({
  title,
  subtitle,
  label,
  url,
  onClose,
}: {
  title: string;
  subtitle: string;
  /** Names the field, e.g. "Invitation link" — the tests and screen readers read it. */
  label: string;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      width={480}
      topOffset="14vh"
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className={styles.linkRow}>
        <Input readOnly value={url} aria-label={label} className={styles.link} />
        <Button
          variant="ghost"
          onClick={async () => {
            setCopied(await copyText(url));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className={styles.linkHint}>
        Anyone with this link can use it once, and it expires on its own. Send it over a channel you
        trust.
      </p>
    </Modal>
  );
}
