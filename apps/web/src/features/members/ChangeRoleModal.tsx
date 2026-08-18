import { useState } from 'react';
import { useUpdateMember } from '@/api/mutations';
import { useRoles } from '@/api/queries';
import { Button, Modal } from '@/components/ui';
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
  const byId = roleMap(roles.data === undefined ? [] : roles.data.roles);

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
            disabled={update.isPending || role === member.role}
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
      <RoleCards name="change-role" value={role} onChange={setRole} />
    </Modal>
  );
}
