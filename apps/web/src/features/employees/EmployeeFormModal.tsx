import { useState, type FormEvent } from 'react';
import {
  can,
  DEPARTMENT_SUGGESTIONS,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  type EmployeeStatus,
  type Role,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateEmployee, useDeleteEmployee, useUpdateEmployee } from '@/api/mutations';
import type { Employee } from '@/api/types';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import styles from '@/components/ui/FormModal.module.css';

const OTHER = 'Other…';

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  department: string;
  location: string;
  startDate: string;
  employeeCode: string;
  status: EmployeeStatus;
  returnDueDate: string;
};

const EMPTY: FormState = {
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
export function EmployeeFormModal({
  employee,
  role,
  onClose,
  onDeleted,
}: {
  employee?: Employee;
  role: Role;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const editing = employee !== undefined;
  const [form, setForm] = useState<FormState>(
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

  const toast = useToast();
  const create = useCreateEmployee();
  const update = useUpdateEmployee(employee?.id ?? '');
  const remove = useDeleteEmployee();

  const pending = create.isPending || update.isPending || remove.isPending;
  const errors = fieldErrors(create.error ?? update.error);
  const failure = create.error ?? update.error ?? remove.error;
  const startsOffboarding =
    editing && employee.status === 'active' && form.status === 'offboarding';
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
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
        toast.show(`${created.displayName} added.`, 'ok');
        onClose();
      },
    });
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
                <Select
                  id={id}
                  value={form.department}
                  onChange={(event) => {
                    if (event.target.value === OTHER) {
                      setCustomDepartment(true);
                      set('department', '');
                      return;
                    }
                    set('department', event.target.value);
                  }}
                >
                  <option value="">—</option>
                  {DEPARTMENT_SUGGESTIONS.filter((option) => option !== 'Other').map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={OTHER}>{OTHER}</option>
                </Select>
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

        {editing && (
          <div className={styles.custom}>
            <Field label="Status" error={errors.status}>
              {(id) => (
                <Select
                  id={id}
                  value={form.status}
                  onChange={(event) => set('status', event.target.value as EmployeeStatus)}
                >
                  {EMPLOYEE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {EMPLOYEE_STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
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
