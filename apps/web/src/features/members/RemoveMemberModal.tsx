import { useRemoveMember } from '@/api/mutations';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { RemoveMemberModalProps } from './types/removeMemberModal';
import styles from './Members.module.css';

/**
 * Removing a member is not removing a person: the employee record, the assets
 * they hold and everything they did in the log all stay. This says so, because
 * "Remove" beside a name reads like it might mean more than it does.
 */
export function RemoveMemberModal({ member, onClose }: RemoveMemberModalProps) {
  const toast = useToast();
  const remove = useRemoveMember();

  return (
    <Modal
      title={`Remove ${member.displayName}?`}
      width={460}
      topOffset="16vh"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(member.id, {
                onSuccess: () => {
                  toast.show(`Removed ${member.displayName}.`, 'ok');
                  onClose();
                },
                onError: (error) => toast.show(error.message, 'err'),
              })
            }
          >
            Remove member
          </Button>
        </>
      }
    >
      <p className={styles.confirm}>
        <strong>{member.email}</strong> will no longer be able to sign in, and any session they have
        open ends immediately.
      </p>
      <p className={styles.confirmHint}>
        {member.linkedEmployee
          ? `Their employee record (${member.linkedEmployee.displayName}) and anything they hold stay exactly as they are.`
          : 'Everything they did stays in the activity log under their name.'}
      </p>
    </Modal>
  );
}
