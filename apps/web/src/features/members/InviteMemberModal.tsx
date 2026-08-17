import { useState, type FormEvent } from 'react';
import type { Role } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useInviteMember } from '@/api/mutations';
import { useEmployees } from '@/api/queries';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { NotifyCheckbox } from '@/components/app/NotifyCheckbox';
import formStyles from '@/components/ui/FormModal.module.css';
import { CopyLinkModal } from './CopyLinkModal';
import { RoleCards } from './RoleCards';

/**
 * Inviting grants sign-in access. The link comes back in the response whether
 * or not an email went out, so this ends on the link rather than on a claim
 * that something was sent — SMTP arrives in a later PR, and an instance
 * without it must still be able to add people.
 */
export function InviteMemberModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  // The least a new member can be given; the admin raises it deliberately.
  const [role, setRole] = useState<Role>('viewer');
  const [sendEmail, setSendEmail] = useState(true);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const employees = useEmployees();
  const invite = useInviteMember();
  const errors = fieldErrors(invite.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    invite.mutate(
      // "" is the select's "— No link —", which is no link at all.
      { email, role, employeeId: employeeId === '' ? null : employeeId, sendEmail },
      { onSuccess: (result) => setInviteUrl(result.inviteUrl) },
    );
  }

  if (inviteUrl) {
    return (
      <CopyLinkModal
        title="Invitation ready"
        subtitle={`${email} can now join the workspace`}
        label="Invitation link"
        url={inviteUrl}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      title="Invite member"
      subtitle="Grants sign-in access to this app"
      width={480}
      topOffset="11vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-member" disabled={invite.isPending}>
            Send invite
          </Button>
        </>
      }
    >
      <form id="invite-member" className={formStyles.form} onSubmit={submit} noValidate>
        <Field label="Email" required error={errors.email}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              placeholder="person@acme.io"
              autoFocus
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Link to employee"
          hint="Optional — connects the account to an employee record"
          error={errors.employeeId}
        >
          {(id) => (
            <Select
              id={id}
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">— No link —</option>
              {/* Employees that have not loaded are no employees to offer. */}
              {(employees.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Role" required>
          <RoleCards name="invite-role" value={role} onChange={setRole} />
        </Field>

        <NotifyCheckbox
          checked={sendEmail}
          onChange={setSendEmail}
          label="Send invitation email now"
        />

        {invite.error && !errors.email && !errors.employeeId && (
          <div className={formStyles.formError}>{invite.error.message}</div>
        )}
      </form>
    </Modal>
  );
}
