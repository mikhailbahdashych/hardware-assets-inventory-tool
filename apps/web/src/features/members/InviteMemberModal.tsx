import { useState, type FormEvent } from 'react';
import { fieldErrors } from '@/api/formErrors';
import { useInviteMember } from '@/api/mutations';
import { useEmployees, useRoles } from '@/api/queries';
import { leastPrivileged } from '@/lib/roles';
import { Button, Dropdown, Field, Input, Modal } from '@/components/ui';
import { NotifyCheckbox } from '@/components/app/NotifyCheckbox';
import formStyles from '@/components/ui/FormModal.module.css';
import { CopyLinkModal } from './CopyLinkModal';
import { RoleCards } from './RoleCards';
import type { InviteMemberModalProps } from './types/inviteMemberModal';

/**
 * Inviting grants sign-in access. The link comes back in the response whether
 * or not an email went out, so this ends on the link rather than on a claim
 * that something was sent — SMTP arrives in a later PR, and an instance
 * without it must still be able to add people.
 */
export function InviteMemberModal({ onClose }: InviteMemberModalProps) {
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [chosenRole, setChosenRole] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const employees = useEmployees();
  const roles = useRoles();
  const invite = useInviteMember();
  const errors = fieldErrors(invite.error);

  // Until the admin picks one it is the least a new member can be given —
  // which is a question about the workspace's rows, not a slug this build can
  // name. Empty only while the roles are still on their way, and Send is
  // disabled until then: an invitation has to name a role that exists.
  const suggested = leastPrivileged(roles.data === undefined ? [] : roles.data.roles);
  const role = chosenRole === '' && suggested ? suggested.id : chosenRole;

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
          <Button type="submit" form="invite-member" disabled={invite.isPending || role === ''}>
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
            <Dropdown
              id={id}
              value={employeeId}
              options={[
                { value: '', label: '— No link —' },
                // Employees that have not loaded are no employees to offer.
                ...(employees.data ?? []).map((employee) => ({
                  value: employee.id,
                  label: employee.displayName,
                })),
              ]}
              onChange={setEmployeeId}
            />
          )}
        </Field>

        <Field label="Role" required>
          <RoleCards name="invite-role" value={role} onChange={setChosenRole} />
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
