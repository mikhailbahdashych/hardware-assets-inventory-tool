import { useRef, useState, type FormEvent } from 'react';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldType,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateCustomField, useDeleteCustomField, useUpdateCustomField } from '@/api/mutations';
import { useCustomFields } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, Card, Dropdown, ErrorState, Field, Input, Spinner } from '@/components/ui';
import { survivor } from '@/lib/survivor';
import { useToast } from '@/providers/ToastProvider';
import formStyles from '@/components/ui/FormModal.module.css';
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
  // The row whose Delete takes focus as it mounts: the neighbour of the field
  // just deleted. Null until one is.
  const [refocus, setRefocus] = useState<string | null>(null);
  // Null until the input mounts; it has whenever a delete can land.
  const newField = useRef<HTMLInputElement>(null);
  // Null while no row is being renamed — what each `renaming?.id` below reads.
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);

  const toast = useToast();
  // Read again on arrival — see useCustomFields in api/queries.ts.
  const fields = useCustomFields('always');
  const create = useCreateCustomField();
  const update = useUpdateCustomField();
  const remove = useDeleteCustomField();
  const errors = fieldErrors(create.error);
  // Writes fail in the server's words, like every other write in the app.
  const failed = (error: Error) => toast.show(error.message, 'err');

  function rename(id: string, next: string) {
    update.mutate({ id, label: next }, { onSuccess: () => setRenaming(null), onError: failed });
  }

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

      {/* Failed, then not yet here, then the definitions — three states, three
          branches, and `data` is defined in the last one. The add form goes
          with them: a form for a list nobody could read is an invitation to
          add what is already there. */}
      {fields.isError ? (
        <Card padding={false}>
          <ErrorState error={fields.error} onRetry={() => void fields.refetch()}>
            The custom fields could not be loaded.
          </ErrorState>
        </Card>
      ) : !fields.isSuccess ? (
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
                      aria-label={`New name for ${field.label}`}
                      autoFocus
                      onChange={(event) => setRenaming({ id: field.id, label: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        rename(field.id, renaming.label);
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
                      aria-label={`Save ${field.label}`}
                      disabled={update.isPending}
                      onClick={() => rename(field.id, renaming.label)}
                    >
                      Save
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${field.label}`}
                      onClick={() => setRenaming({ id: field.id, label: field.label })}
                    >
                      Rename
                    </Button>
                  )}
                  {/* Two steps, because deleting takes the values. The armed
                      step takes focus so a keyboard user is on it, and
                      Escape or leaving it disarms — a confirm that stays
                      armed behind your back is not a confirm. */}
                  <Button
                    // A new key remounts the button, which is what lets autoFocus act.
                    key={refocus === field.id ? 'refocus' : 'delete'}
                    autoFocus={refocus === field.id}
                    variant="danger"
                    size="sm"
                    aria-label={
                      confirmingDelete === field.id
                        ? `Delete values too: ${field.label}`
                        : `Delete ${field.label}`
                    }
                    disabled={remove.isPending}
                    onBlur={() => setConfirmingDelete(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && confirmingDelete === field.id) {
                        setConfirmingDelete(null);
                      }
                    }}
                    onClick={(event) => {
                      if (confirmingDelete !== field.id) {
                        setConfirmingDelete(field.id);
                        // Safari does not focus a clicked button; blur needs it.
                        event.currentTarget.focus();
                        return;
                      }
                      remove.mutate(field.id, {
                        onSuccess: () => {
                          toast.show(`Deleted "${field.label}" and its values.`, 'ok');
                          setConfirmingDelete(null);
                          // Its neighbour's Delete, or the add form when it
                          // was the last. (Escape needs nothing: the armed
                          // step is this same button, so focus never left.)
                          const next = survivor(
                            fields.data.map((row) => row.id),
                            field.id,
                          );
                          setRefocus(next);
                          if (next === null) newField.current?.focus();
                        },
                        onError: failed,
                      });
                    }}
                  >
                    {confirmingDelete === field.id ? 'Delete values too' : 'Delete'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* A failure no field is to blame for — a 409, a dead database —
              still has to be said somewhere, or Add field just goes quiet. */}
          {create.error && errors.label === undefined && (
            <div className={formStyles.formError} role="alert">
              {create.error.message}
            </div>
          )}
          <form className={styles.add} onSubmit={submit} noValidate>
            <Field label="New field" error={errors.label}>
              {(id) => (
                <Input
                  ref={newField}
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
