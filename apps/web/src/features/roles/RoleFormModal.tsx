import { useState, type FormEvent } from 'react';
import { roleSlug, SEMANTIC_COLORS, SEMANTIC_COLOR_LABELS } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateRole, useUpdateRole } from '@/api/mutations';
import { Button, Dropdown, Field, Input, Modal, Pill } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { RoleFormModalProps, RoleFormState } from './types/roleFormModal';
import formStyles from '@/components/ui/FormModal.module.css';
import styles from './Roles.module.css';

/**
 * One form for adding a role and for renaming one — the same mode switch the
 * status form uses, because an edit that looked different would be a second
 * thing to keep in sync.
 *
 * The grants are deliberately not here: they live in the matrix below, where
 * they can be compared and flipped across every role at once. The id is not
 * here either — it is derived from the label the once, and member rows carry
 * it, so a rename is never an identity change.
 */
export function RoleFormModal({ role, onClose }: RoleFormModalProps) {
  const editing = role !== undefined;
  const [form, setForm] = useState<RoleFormState>(
    editing
      ? // A null description is an empty field, which is what it means.
        { label: role.label, description: role.description ?? '', color: role.color }
      : { label: '', description: '', color: 'neut' },
  );

  const toast = useToast();
  const create = useCreateRole();
  const update = useUpdateRole();
  const pending = create.isPending || update.isPending;
  // Whichever of the two ran is the one that can have failed.
  const failure = create.error ?? update.error;
  const errors = fieldErrors(failure);

  const slug = roleSlug(form.label);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (editing) {
      update.mutate(
        { id: role.id, label: form.label, description: form.description, color: form.color },
        {
          onSuccess: ({ role: saved }) => {
            toast.show(`Saved "${saved.label}".`, 'ok');
            onClose();
          },
        },
      );
      return;
    }
    create.mutate(
      { label: form.label, description: form.description, color: form.color },
      {
        onSuccess: ({ role: created }) => {
          toast.show(`Added the role "${created.label}".`, 'ok');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title={editing ? 'Edit role' : 'Add role'}
      subtitle={
        editing
          ? 'What this role is called, and how it reads'
          : 'A name for a set of permissions to hand out'
      }
      width={420}
      topOffset="12vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" disabled={pending || form.label.trim() === ''}>
            {editing ? 'Save role' : 'Add role'}
          </Button>
        </>
      }
    >
      <form id="role-form" className={formStyles.form} onSubmit={submit} noValidate>
        {failure && !Object.keys(errors).length && (
          <div className={formStyles.formError} role="alert">
            {failure.message}
          </div>
        )}

        <Field
          label="Name"
          required
          error={errors.label}
          hint={
            editing
              ? // The id was fixed when the role was created; only the words move.
                `Stored as ${role.id} — renaming leaves that alone`
              : slug === ''
                ? 'Stored as a slug — letters and numbers, please'
                : `Stored as ${slug}`
          }
        >
          {(id) => (
            <Input
              id={id}
              value={form.label}
              placeholder="e.g. Auditor"
              autoFocus
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Description"
          hint="The line under the name on the invite card"
          error={errors.description}
        >
          {(id) => (
            <Input
              id={id}
              value={form.description}
              placeholder="e.g. Reads the books: activity log and exports"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          )}
        </Field>

        <Field label="Color" error={errors.color}>
          {(id) => (
            <Dropdown
              id={id}
              value={form.color}
              options={SEMANTIC_COLORS.map((color) => ({
                value: color,
                label: SEMANTIC_COLOR_LABELS[color],
                description: color,
              }))}
              onChange={(color) => setForm({ ...form, color })}
            />
          )}
        </Field>

        <div className={styles.preview}>
          <span className={styles.previewLabel}>Preview</span>
          <Pill sv={form.color} dot>
            {form.label.trim() === '' ? 'Role' : form.label}
          </Pill>
        </div>

        {!editing && (
          <p className={formStyles.empty}>
            New roles start with no permissions — grant them in the matrix below.
          </p>
        )}
      </form>
    </Modal>
  );
}
