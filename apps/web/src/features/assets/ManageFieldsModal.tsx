import { useState, type FormEvent } from 'react';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldType,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateCustomField, useDeleteCustomField, useUpdateCustomField } from '@/api/mutations';
import { useCustomFields } from '@/api/queries';
import { Button, Dropdown, Field, Input, Modal } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import formStyles from '@/components/ui/FormModal.module.css';
import styles from './ManageFields.module.css';

/**
 * Custom fields are how an adopting team describes their own hardware, so this
 * is the one screen that changes the shape of every asset. Renaming is safe —
 * the key stored values hang off never moves — but deleting takes the values.
 */
export function ManageFieldsModal({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);

  const toast = useToast();
  const fields = useCustomFields();
  const create = useCreateCustomField();
  const update = useUpdateCustomField();
  const remove = useDeleteCustomField();
  const errors = fieldErrors(create.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { label, type },
      {
        onSuccess: () => {
          toast.show(`Added the field "${label}".`, 'ok');
          setLabel('');
          setType('text');
        },
      },
    );
  }

  return (
    <Modal
      title="Manage fields"
      subtitle="The details you track on every asset"
      width={480}
      topOffset="11vh"
      maxHeight="80vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>Values are kept under the field key</span>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className={styles.list}>
        {/* Definitions that have not loaded are no definitions to list. */}
        {(fields.data ?? []).map((field) => (
          <div key={field.id} className={styles.row}>
            {renaming?.id === field.id ? (
              <Input
                value={renaming.label}
                aria-label={`Rename ${field.label}`}
                autoFocus
                onChange={(event) => setRenaming({ id: field.id, label: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  update.mutate(
                    { id: field.id, label: renaming.label },
                    { onSuccess: () => setRenaming(null) },
                  );
                }}
              />
            ) : (
              <div className={styles.text}>
                <div className={styles.label}>{field.label}</div>
                <div className={styles.meta}>
                  <span className={styles.key}>{field.key}</span> ·{' '}
                  {CUSTOM_FIELD_TYPE_LABELS[field.type]}
                </div>
              </div>
            )}

            {renaming?.id === field.id ? (
              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: field.id, label: renaming.label },
                    { onSuccess: () => setRenaming(null) },
                  )
                }
              >
                Save
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRenaming({ id: field.id, label: field.label })}
              >
                Rename
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                if (confirmingDelete !== field.id) {
                  setConfirmingDelete(field.id);
                  return;
                }
                remove.mutate(field.id, {
                  onSuccess: () => {
                    toast.show(`Deleted "${field.label}" and its values.`, 'ok');
                    setConfirmingDelete(null);
                  },
                });
              }}
            >
              {confirmingDelete === field.id ? 'Delete values too' : 'Delete'}
            </Button>
          </div>
        ))}
      </div>

      <form className={styles.add} onSubmit={submit} noValidate>
        <Field label="New field" error={errors.label}>
          {(id) => (
            <Input
              id={id}
              value={label}
              placeholder="e.g. Warranty provider"
              onChange={(event) => setLabel(event.target.value)}
            />
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <Dropdown
              id={id}
              value={type}
              options={CUSTOM_FIELD_TYPES.map((option) => ({
                value: option,
                label: CUSTOM_FIELD_TYPE_LABELS[option],
              }))}
              onChange={setType}
            />
          )}
        </Field>
        <Button type="submit" disabled={create.isPending || label.trim() === ''}>
          Add field
        </Button>
      </form>
    </Modal>
  );
}
