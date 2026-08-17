import { useState, type FormEvent } from 'react';
import {
  can,
  DEPARTMENT_SUGGESTIONS,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  type Role,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import {
  useCreateEmployee,
  useDeleteEmployee,
  useInviteMember,
  useUpdateEmployee,
} from '@/api/mutations';
import { Button, Checkbox, Dropdown, Field, Input, Modal } from '@/components/ui';
// Inviting is a members concern; this form borrows it rather than growing a
// second way to show a one-time link.
import { CopyLinkModal } from '@/features/members/CopyLinkModal';
import { useToast } from '@/providers/ToastProvider';
import type { EmployeeFormModalProps, EmployeeFormState } from './types/employeeFormModal';
import styles from '@/components/ui/FormModal.module.css';

const OTHER = 'Other…';

const EMPTY: EmployeeFormState = {
  firstName: '',
  lastName: '',
  email: '',
  jobTitle: '',
  department: '',
  location: '',
  startDate: '',
  employeeCode: '',
  status: 'active',
  returnDueDate: '',
};

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim());

/**
 * Create and edit share this form; editing adds the status control, because
 * marking somebody as offboarding is the one employee change with a
 * consequence elsewhere (it schedules returns for what they hold).
 */
export function EmployeeFormModal({ employee, role, onClose, onDeleted }: EmployeeFormModalProps) {
  const editing = employee !== undefined;
  // Every `?? ''` below translates a NULL column into the empty input that
  // means the same thing to the person filling the form in.
  const [form, setForm] = useState<EmployeeFormState>(
    editing
      ? {
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
          jobTitle: employee.jobTitle ?? '',
          department: employee.department ?? '',
          location: employee.location ?? '',
          startDate: employee.startDate ?? '',
          employeeCode: employee.employeeCode ?? '',
          status: employee.status,
          returnDueDate: '',
        }
      : EMPTY,
  );
  // A department that is not one of the suggestions still has to be editable.
  const [customDepartment, setCustomDepartment] = useState(
    Boolean(form.department) &&
      !(DEPARTMENT_SUGGESTIONS as readonly string[]).includes(form.department),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The design's "Also invite as a member of this app", admin-only because
  // inviting is. Viewer is the least a new account can be given.
  const [inviting, setInviting] = useState(false);
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const toast = useToast();
  const create = useCreateEmployee();
  // Create mode never fires this hook; it still needs a string to build a URL.
  const update = useUpdateEmployee(employee?.id ?? '');
  const remove = useDeleteEmployee();
  const invite = useInviteMember();

  const pending = create.isPending || update.isPending || remove.isPending || invite.isPending;
  // Whichever of the three ran is the one that can have failed.
  const errors = fieldErrors(create.error ?? update.error);
  const failure = create.error ?? update.error ?? remove.error;
  const startsOffboarding =
    editing && employee.status === 'active' && form.status === 'offboarding';
  const set = <K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const shared = {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      jobTitle: blankToNull(form.jobTitle),
      department: blankToNull(form.department),
      location: blankToNull(form.location),
      employeeCode: blankToNull(form.employeeCode),
      startDate: blankToNull(form.startDate),
    };

    if (editing) {
      update.mutate(
        {
          ...shared,
          status: form.status,
          returnDueDate: startsOffboarding ? blankToNull(form.returnDueDate) : null,
        },
        {
          onSuccess: () => {
            toast.show('Employee saved.', 'ok');
            onClose();
          },
        },
      );
      return;
    }

    create.mutate(shared, {
      onSuccess: ({ employee: created }) => {
        if (!inviting) {
          toast.show(`${created.displayName} added.`, 'ok');
          onClose();
          return;
        }
        // Two requests, deliberately: if the invitation fails the person is
        // still on file and can be invited from the Members page. Rolling the
        // record back to keep the pair atomic would throw away typed-in work.
        invite.mutate(
          { email: created.email, role: inviteRole, employeeId: created.id, sendEmail: true },
          {
            onSuccess: ({ inviteUrl: url }) => setInviteUrl(url),
            onError: (error) =>
              toast.show(
                `${created.displayName} was added, but the invitation failed: ${error.message}`,
                'err',
              ),
          },
        );
      },
    });
  }

  if (inviteUrl) {
    return (
      <CopyLinkModal
        title="Invitation ready"
        subtitle={`${form.email} is on file and can now sign in`}
        label="Invitation link"
        url={inviteUrl}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      title={editing ? 'Edit employee' : 'Add employee'}
      subtitle={
        editing
          ? 'Update this person’s record'
          : 'A person who can hold assets — no app access implied'
      }
      width={520}
      topOffset="9vh"
      maxHeight="84vh"
      onClose={onClose}
      footer={
        <>
          <div className={styles.footerLeft}>
            <span className={styles.required}>* Required</span>
            {editing && can(role, 'employees.delete') && (
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  remove.mutate(employee.id, {
                    onSuccess: () => {
                      toast.show(`${employee.displayName} removed.`, 'ok');
                      (onDeleted ?? onClose)();
                    },
                  });
                }}
              >
                {confirmingDelete ? 'Confirm remove' : 'Remove person'}
              </Button>
            )}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" disabled={pending}>
            {editing ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      <form id="employee-form" className={styles.form} onSubmit={submit} noValidate>
        {failure && !Object.keys(errors).length && (
          <div className={styles.formError} role="alert">
            {failure.message}
          </div>
        )}

        <div className={styles.pair}>
          <Field label="First name" required error={errors.firstName}>
            {(id) => (
              <Input
                id={id}
                value={form.firstName}
                placeholder="Maya"
                onChange={(event) => set('firstName', event.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            {(id) => (
              <Input
                id={id}
                value={form.lastName}
                placeholder="Lindqvist"
                onChange={(event) => set('lastName', event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Work email"
          required
          hint="Used to match CSV imports and member invites"
          error={errors.email}
        >
          {(id) => (
            <Input
              id={id}
              type="email"
              value={form.email}
              placeholder="maya.lindqvist@acme.io"
              onChange={(event) => set('email', event.target.value)}
            />
          )}
        </Field>

        <div className={styles.pair}>
          <Field label="Job title" error={errors.jobTitle}>
            {(id) => (
              <Input
                id={id}
                value={form.jobTitle}
                placeholder="e.g. Product Designer"
                onChange={(event) => set('jobTitle', event.target.value)}
              />
            )}
          </Field>
          <Field label="Department" error={errors.department}>
            {(id) =>
              customDepartment ? (
                <Input
                  id={id}
                  value={form.department}
                  placeholder="Department"
                  onChange={(event) => set('department', event.target.value)}
                />
              ) : (
                <Dropdown
                  id={id}
                  value={form.department}
                  options={[
                    { value: '', label: '—' },
                    ...DEPARTMENT_SUGGESTIONS.filter((option) => option !== 'Other').map(
                      (option) => ({ value: option, label: option }),
                    ),
                    { value: OTHER, label: OTHER },
                  ]}
                  onChange={(department) => {
                    if (department === OTHER) {
                      setCustomDepartment(true);
                      set('department', '');
                      return;
                    }
                    set('department', department);
                  }}
                />
              )
            }
          </Field>
          <Field label="Location" error={errors.location}>
            {(id) => (
              <Input
                id={id}
                value={form.location}
                placeholder="e.g. Stockholm"
                onChange={(event) => set('location', event.target.value)}
              />
            )}
          </Field>
          <Field label="Start date" error={errors.startDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.startDate}
                onChange={(event) => set('startDate', event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Employee ID" error={errors.employeeCode}>
          {(id) => (
            <Input
              id={id}
              mono
              value={form.employeeCode}
              placeholder="EMP-0090 · optional"
              onChange={(event) => set('employeeCode', event.target.value)}
            />
          )}
        </Field>

        {!editing && can(role, 'members.manage') && (
          <div className={styles.custom}>
            <Checkbox
              checked={inviting}
              onChange={(event) => setInviting(event.target.checked)}
              label="Also invite as a member of this app"
            />
            {inviting && (
              <Field
                label="Role"
                hint="They get an invitation link straight after the record is created"
              >
                {(id) => (
                  <Dropdown
                    id={id}
                    value={inviteRole}
                    options={ROLES.map((option) => ({
                      value: option,
                      label: ROLE_LABELS[option],
                      description: ROLE_DESCRIPTIONS[option],
                    }))}
                    onChange={setInviteRole}
                  />
                )}
              </Field>
            )}
          </div>
        )}

        {editing && (
          <div className={styles.custom}>
            <Field label="Status" error={errors.status}>
              {(id) => (
                <Dropdown
                  id={id}
                  value={form.status}
                  options={EMPLOYEE_STATUSES.map((status) => ({
                    value: status,
                    label: EMPLOYEE_STATUS_LABELS[status],
                  }))}
                  onChange={(status) => set('status', status)}
                />
              )}
            </Field>
            {startsOffboarding && (
              <Field
                label="Return due"
                hint={`Sets the return date on the ${employee.activeAssetCount} asset${
                  employee.activeAssetCount === 1 ? '' : 's'
                } they hold`}
                error={errors.returnDueDate}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={form.returnDueDate}
                    onChange={(event) => set('returnDueDate', event.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
