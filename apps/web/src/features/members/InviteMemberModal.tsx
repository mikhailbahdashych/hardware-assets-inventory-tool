import { useState, type FormEvent } from 'react';
import { fieldErrors } from '@/api/formErrors';
import { useInviteMember } from '@/api/mutations';
import { DROPDOWN_LIMIT, useEmployees, useRoles } from '@/api/queries';
import { leastPrivileged } from '@/lib/roles';
import { Button, Dropdown, ErrorState, Field, Input, Modal } from '@/components/ui';
import formStyles from '@/components/ui/FormModal.module.css';
import { CopyLinkModal } from './CopyLinkModal';
import { RoleCards } from './RoleCards';
import type { InviteMemberModalProps } from './types/inviteMemberModal';

/**
 * Inviting grants sign-in access. The link in the response is the whole
 * delivery mechanism, so this ends on it, shown once as copyable text — the
 * admin hands it over on a channel the workspace already trusts.
 */
export function InviteMemberModal({ onClose }: InviteMemberModalProps) {
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [chosenRole, setChosenRole] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // A dropdown has no search box, so it asks for as many people as the
  // endpoint will give — see DROPDOWN_LIMIT for what happens past that.
  const employees = useEmployees({ limit: DROPDOWN_LIMIT, offset: 0 });
  const roles = useRoles();
  const invite = useInviteMember();
  const errors = fieldErrors(invite.error);

  /**
   * Both reads fill a control on this form, so the first failure among them is
   * the form's — the same rule a page follows (apps/web/CLAUDE.md). It replaces
   * the two fields rather than the whole body: the email above it is typed, not
   * fetched, and a panel is no reason to throw it away.
   */
  const failure = roles.isError ? roles.error : employees.isError ? employees.error : null;

  function retry(): void {
    void roles.refetch();
    void employees.refetch();
  }

  // Until the admin picks one it is the least a new member can be given —
  // which is a question about the workspace's rows, not a slug this build can
  // name. Empty only while the roles are still on their way, and Send is
  // disabled until then: an invitation has to name a role that exists.
  const suggested = leastPrivileged(roles.isSuccess ? roles.data.roles : []);
  const role = chosenRole === '' && suggested ? suggested.id : chosenRole;

  function submit(event: FormEvent) {
    event.preventDefault();
    invite.mutate(
      // "" is the select's "— No link —", which is no link at all.
      { email, role, employeeId: employeeId === '' ? null : employeeId },
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
          {/* An invitation that cannot name a role is one nobody should be
              able to send — and it cannot, until the workspace's own rows say
              what the roles are. */}
          <Button
            type="submit"
            form="invite-member"
            disabled={invite.isPending || failure !== null || role === ''}
          >
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

        {/* Failed, then the controls — and in the second branch there is
            nothing to coalesce: a dropdown holding only "— No link —" reads as
            a workspace with nobody on file, and a role card list that never
            arrives is the spinner this panel replaces. */}
        {failure !== null ? (
          <ErrorState error={failure} onRetry={retry}>
            The roles and people this invitation offers could not be loaded.
          </ErrorState>
        ) : (
          <>
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
                    ...(employees.isSuccess ? employees.data.employees : []).map((employee) => ({
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
          </>
        )}

        {invite.error && !errors.email && !errors.employeeId && (
          <div className={formStyles.formError}>{invite.error.message}</div>
        )}
      </form>
    </Modal>
  );
}
