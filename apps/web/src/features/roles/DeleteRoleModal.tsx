import { useState } from 'react';
import { ApiError } from '@/api/client';
import { useDeleteRole } from '@/api/mutations';
import { Button, Dropdown, Field, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { DeleteRoleModalProps } from './types/deleteRoleModal';
import formStyles from '@/components/ui/FormModal.module.css';

/**
 * Deleting a role, in the order the facts arrive. The first press asks for the
 * delete plainly; if anybody still holds the role the API refuses with a 409
 * that says how many, and only then does this ask where they should go.
 *
 * The count comes from the server rather than from the member list, because
 * between opening the modal and pressing the button the server's answer is the
 * only one still true — and invited members count too, so a list filtered to
 * the people who have actually signed in would undercount.
 */
export function DeleteRoleModal({ role, destinations, onClose }: DeleteRoleModalProps) {
  const [migrateTo, setMigrateTo] = useState(destinations[0]?.id ?? '');

  const toast = useToast();
  const remove = useDeleteRole();
  // The one refusal this modal answers rather than reports: it means the delete
  // needs a destination, which is the second half of this form.
  const inUse = remove.error instanceof ApiError && remove.error.code === 'role_in_use';

  const submit = (destination?: string) =>
    remove.mutate(
      { id: role.id, migrateTo: destination },
      {
        onSuccess: () => {
          toast.show(`Deleted "${role.label}".`, 'ok');
          onClose();
        },
      },
    );

  return (
    <Modal
      title={`Delete ${role.label}`}
      subtitle="The role goes, and every permission granted to it"
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
              Delete role
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
            {role.label} leaves the invite form and the permissions matrix. If anybody still holds
            it, this will ask which role they move to.
          </p>
        )}
      </div>
    </Modal>
  );
}
