import { useState } from 'react';
import { ApiError } from '@/api/client';
import { useDeleteRole } from '@/api/mutations';
import { Button, Dropdown, Field, Modal } from '@/components/ui';
import { leastPrivileged } from '@/lib/roles';
import { useToast } from '@/providers/ToastProvider';
import type { DeleteRoleModalProps } from './types/deleteRoleModal';
import formStyles from '@/components/ui/FormModal.module.css';

/**
 * Deleting a role, in the order the facts arrive. The row already says how
 * many members hold it (`memberCount`, the server's own count, invitations
 * included), so a held role opens straight on where they should go — in plain
 * words, because nothing has gone wrong. A role the page counted as empty asks
 * for the delete plainly; if somebody took it since, the API refuses with a
 * 409 that says how many, and the same picker appears under its sentence.
 */
export function DeleteRoleModal({ role, destinations, onClose }: DeleteRoleModalProps) {
  // Preselected: the destination granting the fewest actions — the invite
  // form's reasoning, with more at stake. The list is in the workspace's own
  // order, which puts Admin first, and a hasty "Move and delete" must be a
  // demotion at worst, never a mass promotion. Empty only if there is nothing
  // to migrate to, and the button stays disabled on it.
  const [migrateTo, setMigrateTo] = useState(leastPrivileged(destinations)?.id ?? '');

  const toast = useToast();
  const remove = useDeleteRole();
  // The one refusal this modal answers rather than reports: it means the delete
  // needs a destination, which is the second half of this form.
  const refusedInUse = remove.error instanceof ApiError && remove.error.code === 'role_in_use';
  const inUse = role.memberCount > 0 || refusedInUse;

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
        {inUse && !refusedInUse && (
          <p className={formStyles.empty}>
            {role.memberCount} {role.memberCount === 1 ? 'member holds' : 'members hold'}{' '}
            {role.label}. Choose the role they move to; the delete happens with the move.
          </p>
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
