import { useState, type FormEvent } from 'react';
import { SEMANTIC_COLORS, SEMANTIC_COLOR_LABELS, statusSlug } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateStatus, useUpdateStatus } from '@/api/mutations';
import { Button, Dropdown, Field, Input, Modal, Pill } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { StatusFormModalProps, StatusFormState } from './types/statusFormModal';
import formStyles from '@/components/ui/FormModal.module.css';
import styles from './Workflow.module.css';

/**
 * One form for adding a status and for renaming one — the same mode switch the
 * asset form uses, because an edit that looked different would be a second
 * thing to keep in sync.
 *
 * The two behaviour flags are deliberately not here: they live on the card's
 * rows, where they can be compared and flipped across every status at once.
 * The id is not here either — it is derived from the label the once, and asset
 * rows carry it, so a rename is never an identity change.
 */
export function StatusFormModal({ status, onClose }: StatusFormModalProps) {
  const editing = status !== undefined;
  const [form, setForm] = useState<StatusFormState>(
    editing ? { label: status.label, color: status.color } : { label: '', color: 'neut' },
  );

  const toast = useToast();
  const create = useCreateStatus();
  const update = useUpdateStatus();
  const pending = create.isPending || update.isPending;
  // Whichever of the two ran is the one that can have failed.
  const failure = create.error ?? update.error;
  const errors = fieldErrors(failure);

  const slug = statusSlug(form.label);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (editing) {
      update.mutate(
        { id: status.id, label: form.label, color: form.color },
        {
          onSuccess: ({ status: saved }) => {
            toast.show(`Saved "${saved.label}".`, 'ok');
            onClose();
          },
        },
      );
      return;
    }
    create.mutate(
      // A new status has no behaviour until somebody gives it some: the two
      // flags start off, and the card's row is where they are turned on.
      { label: form.label, color: form.color, assignableFrom: false, checkinTarget: false },
      {
        onSuccess: ({ status: created }) => {
          toast.show(`Added the status "${created.label}".`, 'ok');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title={editing ? 'Edit status' : 'Add status'}
      subtitle={
        editing ? 'What this status is called, and how it reads' : 'A new state an asset can be in'
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
          <Button type="submit" form="status-form" disabled={pending || form.label.trim() === ''}>
            {editing ? 'Save status' : 'Add status'}
          </Button>
        </>
      }
    >
      <form id="status-form" className={formStyles.form} onSubmit={submit} noValidate>
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
              ? // The id was fixed when the status was created; only the words move.
                `Stored as ${status.id} — renaming leaves that alone`
              : slug === ''
                ? 'Stored as a slug — letters and numbers, please'
                : `Stored as ${slug}`
          }
        >
          {(id) => (
            <Input
              id={id}
              value={form.label}
              placeholder="e.g. On loan"
              autoFocus
              onChange={(event) => setForm({ ...form, label: event.target.value })}
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
            {form.label.trim() === '' ? 'Status' : form.label}
          </Pill>
        </div>
      </form>
    </Modal>
  );
}
