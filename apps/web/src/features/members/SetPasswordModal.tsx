import { useState, type FormEvent } from 'react';
import { PASSWORD_HINT } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useSetMemberPassword } from '@/api/mutations';
import { Button, Field, Input, Modal } from '@/components/ui';
import formStyles from '@/components/ui/FormModal.module.css';
import type { SetPasswordModalProps } from './types/setPasswordModal';
import styles from './Members.module.css';

/**
 * Character sets with the lookalikes (l, 1, O, 0, o) left out: this password
 * is read off one screen and typed on another before it lands in a manager.
 */
const SETS = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*-+='];

// A one-length typed array has a 0th element, and the modulo is in range.
const rand = (bound: number): number => crypto.getRandomValues(new Uint32Array(1))[0]! % bound;
const pick = (set: string): string => set[rand(set.length)]!;

/** 16 characters with at least one of each class — the policy by construction. */
function generatePassword(): string {
  const all = SETS.join('');
  const chars = [...SETS.map(pick), ...Array.from({ length: 12 }, () => pick(all))];
  // Fisher–Yates, so the guaranteed classes are not always the first four.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    // Both indices are inside the array by the loop's own bounds.
    const swapped = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = swapped;
  }
  return chars.join('');
}

/**
 * The blunt half of recovery: an admin sets somebody's password outright and
 * hands it over out of band. The field holds readable text, not dots — the
 * whole point is that the admin can read it back.
 */
export function SetPasswordModal({ member, onSet, onClose }: SetPasswordModalProps) {
  const [password, setPassword] = useState('');
  const set = useSetMemberPassword();
  const errors = fieldErrors(set.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    set.mutate({ id: member.id, newPassword: password }, { onSuccess: () => onSet(password) });
  }

  return (
    <Modal
      title="Set a password"
      subtitle={`${member.displayName} signs in with it from now on`}
      width={460}
      topOffset="10vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="set-password" disabled={set.isPending || password === ''}>
            Set password
          </Button>
        </>
      }
    >
      <form id="set-password" className={formStyles.form} onSubmit={submit} noValidate>
        <Field label="New password" required hint={PASSWORD_HINT} error={errors.newPassword}>
          {(id) => (
            <div className={styles.linkRow}>
              <Input
                id={id}
                value={password}
                autoFocus
                autoComplete="off"
                className={styles.link}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button variant="ghost" onClick={() => setPassword(generatePassword())}>
                Generate
              </Button>
            </div>
          )}
        </Field>
        <p className={styles.linkHint}>
          Every session of theirs is signed out the moment it is set.
        </p>
        {set.error && !errors.newPassword && (
          <div className={formStyles.formError}>{set.error.message}</div>
        )}
      </form>
    </Modal>
  );
}
