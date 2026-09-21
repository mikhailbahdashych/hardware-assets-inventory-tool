import { useState, type FormEvent } from 'react';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldType,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateCustomField, useDeleteCustomField, useUpdateCustomField } from '@/api/mutations';
import { useCustomFields } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, Card, Dropdown, Field, Input, Spinner } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import styles from './CustomFields.module.css';

/**
 * What this workspace tracks on every asset, beyond the columns the product
 * ships with.
 *
 * This used to be a modal reached from one asset's detail page, which read as
 * editing that asset when it changes the shape of all of them — so it is a
 * workspace page now, beside Workflow and Roles. Behind `custom_fields.manage`,
 * enforced by the route guard in routes.tsx and by the same action on every
 * endpoint underneath.
 *
 * Renaming is safe — the key stored values hang off never moves — but deleting
 * takes the values, which is why the button asks twice.
 */
export function CustomFieldsPage() {
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
    <PageContainer maxWidth={1060} gap={16}>
      <div>
        <h1 className={styles.title}>Custom fields</h1>
        <p className={styles.summary}>
          The details this workspace tracks on every asset · values are kept under the field key
        </p>
      </div>

      {fields.data === undefined ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <Card>
          {fields.data.length === 0 ? (
            <p className={styles.empty}>
              No custom fields yet. Add one below and it appears on every asset form immediately.
            </p>
          ) : (
            <div className={styles.list}>
              {fields.data.map((field) => (
                <div key={field.id} className={styles.row} data-field={field.key}>
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
          )}

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
        </Card>
      )}
    </PageContainer>
  );
}
