import { useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, can } from '@inventory/shared';
import { useDeleteAttachment, useUploadAttachment } from '@/api/mutations';
import { Card, Icon, IconButton } from '@/components/ui';
import { formatFileSize } from '@/lib/format';
import { useToast } from '@/providers/ToastProvider';
import type { AttachmentsCardProps } from './types/attachmentsCard';
import styles from './Attachments.module.css';

/**
 * Invoices and warranty paperwork. Files are served as downloads rather than
 * links the browser renders, so the anchor points at the API and the browser
 * saves it — see the content-disposition header on the download route.
 */
export function AttachmentsCard({ assetId, attachments, permissions }: AttachmentsCardProps) {
  const input = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
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
              {editable && (
                <IconButton
                  icon="x"
                  label={`Remove ${attachment.filename}`}
                  size={22}
                  onClick={() =>
                    remove.mutate(attachment.id, {
                      onSuccess: () => toast.show(`${attachment.filename} removed.`, 'ok'),
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
