import { useState } from 'react';
import { useUpdateMember } from '@/api/mutations';
import { useRoles } from '@/api/queries';
import { Button, ErrorState, Modal } from '@/components/ui';
import { roleInfo, roleMap } from '@/lib/roles';
import { useToast } from '@/providers/ToastProvider';
import { RoleCards } from './RoleCards';
import type { ChangeRoleModalProps } from './types/changeRoleModal';

/** The same cards the invite form uses, so a role means one thing everywhere. */
export function ChangeRoleModal({ member, onClose }: ChangeRoleModalProps) {
  const [role, setRole] = useState(member.role);
  const toast = useToast();
  const update = useUpdateMember();
  // The toast says what the role is called, not the slug stored on the row.
  const roles = useRoles();
  const byId = roleMap(roles.isSuccess ? roles.data.roles : []);

  return (
    <Modal
      title={`Change role · ${member.displayName}`}
      subtitle="Takes effect on their next request"
      width={480}
      topOffset="14vh"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={update.isPending || roles.isError || role === member.role}
            onClick={() =>
              update.mutate(
                { id: member.id, role },
                {
                  onSuccess: () => {
                    toast.show(`${member.displayName} is now ${roleInfo(byId, role).label}.`, 'ok');
                    onClose();
                  },
                  onError: (error) => toast.show(error.message, 'err'),
                },
              )
            }
          >
            Save role
          </Button>
        </>
      }
    >
      {/* The cards are this modal's whole body, so a read that did not answer
          fills it. Reachable only through a failed *refetch* — the Members
          page gates its table on the same query, so the row this opens from
          cannot be on screen otherwise — but a card list that never arrives is
          a modal nobody can close except by cancelling. */}
      {roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()}>
          The roles to choose from could not be loaded.
        </ErrorState>
      ) : (
        <RoleCards name="change-role" value={role} onChange={setRole} />
      )}
    </Modal>
  );
}
