import { useState } from 'react';
import type { Role } from '@inventory/shared';
import { useUpdateMember } from '@/api/mutations';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { MemberSummary } from '@/types/api';
import { RoleCards } from './RoleCards';

/** The same cards the invite form uses, so a role means one thing everywhere. */
export function ChangeRoleModal({
  member,
  onClose,
}: {
  member: MemberSummary;
  onClose: () => void;
}) {
  const [role, setRole] = useState<Role>(member.role);
  const toast = useToast();
  const update = useUpdateMember();

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
                    toast.show(`${member.displayName} is now a ${role}.`, 'ok');
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
