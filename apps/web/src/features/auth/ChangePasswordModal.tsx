import { useState, type FormEvent } from 'react';
import { fieldErrors } from '@/api/formErrors';
import { useChangePassword } from '@/api/mutations';
import { Button, Field, Input, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import formStyles from '@/components/ui/FormModal.module.css';
import type { ChangePasswordModalProps } from './types/changePasswordModal';

/**
 * The self-service half of password recovery: a signed-in member proves the
 * current password and picks the next one. Every other browser is signed out
 * by the change — the toast says so, because "why was I logged out at home?"
 * should be answered before it is asked.
 */
export function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const change = useChangePassword();
  const toast = useToast();
  const errors = fieldErrors(change.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast.show(
            'Password changed. You stay signed in here — and are signed out everywhere else.',
            'ok',
          );
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title="Change password"
      subtitle="For signing in to this workspace"
      width={460}
      topOffset="10vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="change-password"
            disabled={change.isPending || currentPassword === '' || newPassword === ''}
          >
            Change password
          </Button>
        </>
      }
    >
      <form id="change-password" className={formStyles.form} onSubmit={submit} noValidate>
        <Field label="Current password" required error={errors.currentPassword}>
          {(id) => (
            <Input
              id={id}
              type="password"
              value={currentPassword}
              autoFocus
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="New password"
          required
          hint="At least 10 characters"
          error={errors.newPassword}
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
