import { useState } from 'react';
import { ApiError } from '@/api/client';
import { useDeleteStatus } from '@/api/mutations';
import { Button, Dropdown, Field, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { DeleteStatusModalProps } from './types/deleteStatusModal';
import formStyles from '@/components/ui/FormModal.module.css';

/**
 * Deleting a status, in the order the facts arrive. The first press asks for
 * the delete plainly; if assets are carrying the status the API refuses with a
 * 409 that says how many, and only then does this ask where they should go.
 *
 * The count comes from the server rather than from the asset list, because
 * this page never loads one — and because between opening the modal and
 * pressing the button, the server's answer is the only one still true.
 */
export function DeleteStatusModal({ status, destinations, onClose }: DeleteStatusModalProps) {
  const [migrateTo, setMigrateTo] = useState(destinations[0]?.id ?? '');

  const toast = useToast();
  const remove = useDeleteStatus();
  // The one refusal this modal answers rather than reports: it means the
  // delete needs a destination, which is the second half of this form.
  const inUse = remove.error instanceof ApiError && remove.error.code === 'status_in_use';

  const submit = (destination?: string) =>
    remove.mutate(
      { id: status.id, migrateTo: destination },
      {
        onSuccess: () => {
          toast.show(`Deleted "${status.label}".`, 'ok');
          onClose();
        },
      },
    );

  return (
    <Modal
      title={`Delete ${status.label}`}
      subtitle="The status goes, and every move in or out of it with it"
      width={420}
      topOffset="14vh"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          {inUse ? (
            <Button
              variant="danger"
              disabled={remove.isPending || migrateTo === ''}
              onClick={() => submit(migrateTo)}
            >
              Move and delete
            </Button>
          ) : (
            <Button variant="danger" disabled={remove.isPending} onClick={() => submit()}>
              Delete status
            </Button>
          )}
        </>
      }
    >
      <div className={formStyles.form}>
        {remove.error && (
          <div className={formStyles.formError} role="alert">
            {remove.error.message}
          </div>
        )}
        {inUse ? (
          <Field label="Move them to" required>
            {(id) => (
              <Dropdown
                id={id}
                value={migrateTo}
                options={destinations.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                onChange={setMigrateTo}
              />
            )}
          </Field>
        ) : (
          <p className={formStyles.empty}>
            {status.label} leaves every select and every move in the matrix. If assets are still
            carrying it, this will ask where they go.
          </p>
        )}
      </div>
    </Modal>
  );
}
