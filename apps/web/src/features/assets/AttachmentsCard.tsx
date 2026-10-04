import { useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, can } from '@inventory/shared';
import { useDeleteAttachment, useUploadAttachment } from '@/api/mutations';
import { Button, Card, Icon, IconButton } from '@/components/ui';
import { formatFileSize } from '@/lib/format';
import { survivor } from '@/lib/survivor';
import { useToast } from '@/providers/ToastProvider';
import type { AttachmentsCardProps } from './types/attachmentsCard';
import styles from './Attachments.module.css';

/**
 * Invoices and warranty paperwork. Files are served as downloads rather than
 * links the browser renders, so the anchor points at the API and the browser
 * saves it — see the content-disposition header on the download route.
 */
export function AttachmentsCard({ assetId, attachments, permissions }: AttachmentsCardProps) {
  // Null until the input mounts — what the `?.` on it below reads.
  const input = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  // The row whose × should take focus as it mounts: the one just disarmed, or
  // the neighbour of the one just removed. Null until either happens.
  const [refocus, setRefocus] = useState<string | null>(null);
  // Null until the button mounts; it has whenever a remove can land.
  const uploadButton = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const upload = useUploadAttachment(assetId);
  const remove = useDeleteAttachment();
  const editable = can(permissions, 'assets.manage_attachments');

  return (
    <Card
      title={
        <span className={styles.header}>
          Attachments
          {editable && (
            <button
              ref={uploadButton}
              type="button"
              className={styles.upload}
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
          )}
        </span>
      }
    >
      {editable && (
        <input
          ref={input}
          type="file"
          className={styles.file}
          aria-label="Upload attachment"
          // The server's own list, so the picker greys out what it would
          // refuse — the refusal still exists, because an accept attribute is
          // a suggestion a drag-and-drop can walk straight past.
          accept={ATTACHMENT_ACCEPT}
          onChange={(event) => {
            // A picker closed without a choice hands over no file at all.
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setFailure(null);
            upload.mutate(file, {
              onSuccess: () => toast.show(`${file.name} attached.`, 'ok'),
              onError: (error) => setFailure(error.message),
            });
          }}
        />
      )}

      {failure && (
        <div className={styles.error} role="alert">
          {failure}
        </div>
      )}

      {attachments.length === 0 ? (
        <div className={styles.empty}>No files yet.</div>
      ) : (
        <div className={styles.list}>
          {attachments.map((attachment) => (
            <div key={attachment.id} className={styles.row}>
              <Icon name="file" size={14} strokeWidth={1.6} className={styles.icon} />
              <a className={styles.name} href={`/api/v1/attachments/${attachment.id}`} download>
                {attachment.filename}
              </a>
              <span className={styles.size}>{formatFileSize(attachment.sizeBytes)}</span>
              {/* Two steps, like revoking a token or deleting a custom field:
                  the × arms the row's own button, and that button does it. A
                  removed file is gone from storage, and nothing brings it back. */}
              {editable &&
                (confirmingRemove === attachment.id ? (
                  <Button
                    variant="danger"
                    size="sm"
                    // Armed means focused — a keyboard user is on it — and Escape or
                    // leaving it disarms: a confirm left armed behind you is not one.
                    autoFocus
                    onBlur={() => setConfirmingRemove(null)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      setConfirmingRemove(null);
                      setRefocus(attachment.id);
                    }}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(attachment.id, {
                        onSuccess: () => {
                          toast.show(`${attachment.filename} removed.`, 'ok');
                          setConfirmingRemove(null);
                          // Its neighbour, or Upload when it was the last; and
                          // only that row's × may take focus as it mounts.
                          const next = survivor(
                            attachments.map((row) => row.id),
                            attachment.id,
                          );
                          setRefocus(next);
                          if (next === null) uploadButton.current?.focus();
                        },
                        onError: (error) => toast.show(error.message, 'err'),
                      })
                    }
                  >
                    Remove for good
                  </Button>
                ) : (
                  <IconButton
                    // A new key remounts the button, which is what lets autoFocus act.
                    key={refocus === attachment.id ? 'refocus' : 'remove'}
                    autoFocus={refocus === attachment.id}
                    icon="x"
                    label={`Remove ${attachment.filename}`}
                    size={22}
                    onClick={() => {
                      setConfirmingRemove(attachment.id);
                      // A disarm by leaving must leave focus where it went.
                      setRefocus(null);
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
