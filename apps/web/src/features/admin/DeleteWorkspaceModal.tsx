import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useDeleteWorkspace } from '@/api/mutations';
import { Button, Field, Input, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import styles from './Admin.module.css';

/**
 * Type-to-confirm, matched exactly and case-sensitively — the API checks the
 * same thing, so a typo cannot get through either side. Afterwards there is no
 * session and no data, and the router lands on /setup.
 */
export function DeleteWorkspaceModal({
  orgName,
  onClose,
}: {
  orgName: string;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const remove = useDeleteWorkspace();

  return (
    <Modal
      title="Delete workspace"
      subtitle="Every asset, person, record and account goes"
      width={480}
      topOffset="14vh"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={confirmText !== orgName || remove.isPending}
            onClick={() =>
              remove.mutate(
                { confirmText },
                {
                  onSuccess: () => navigate('/setup', { replace: true }),
                  onError: (error) => toast.show(error.message, 'err'),
                },
              )
            }
          >
            Delete workspace
          </Button>
        </>
      }
    >
      <p className={styles.dangerCopy}>
        This removes every asset, employee, ownership record, attachment and account, including
        yours. It cannot be undone, and there is no export to fall back on.
      </p>
      <Field label={`Type ${orgName} to confirm`}>
        {(id) => (
          <Input
            id={id}
            value={confirmText}
            autoFocus
            autoComplete="off"
            onChange={(event) => setConfirmText(event.target.value)}
          />
        )}
      </Field>
    </Modal>
  );
}
