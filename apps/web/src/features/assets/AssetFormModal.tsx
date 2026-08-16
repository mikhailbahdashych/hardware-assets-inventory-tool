import { useState, type FormEvent } from 'react';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  can,
  centsToInputValue,
  parsePriceToCents,
  type AssetCategory,
  type AssetStatus,
  type Role,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateAsset, useDeleteAsset, useUpdateAsset } from '@/api/mutations';
import { useCustomFields, useEmployees, useNextAssetTag } from '@/api/queries';
import type { Asset, CustomFieldValue } from '@/types/api';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import styles from '@/components/ui/FormModal.module.css';

type FormState = {
  name: string;
  category: AssetCategory;
  status: AssetStatus;
  assetTag: string;
  serialNumber: string;
  model: string;
  assignedToEmployeeId: string;
  checkoutDate: string;
  purchaseDate: string;
  price: string;
  supplier: string;
  warrantyUntil: string;
  notes: string;
  customValues: Record<string, string>;
};

const EMPTY: FormState = {
  name: '',
  category: 'laptops',
  status: 'available',
  assetTag: '',
  serialNumber: '',
  model: '',
  assignedToEmployeeId: '',
  checkoutDate: '',
  purchaseDate: '',
  price: '',
  supplier: '',
  warrantyUntil: '',
  notes: '',
  customValues: {},
};

/**
 * A NULL column and an empty input are the same state to a person filling in
 * this form, so every `?? ''` below is the translation between them — not a
 * value invented because one was missing.
 */
function fromAsset(asset: Asset, customFields: CustomFieldValue[]): FormState {
  return {
    ...EMPTY,
    name: asset.name,
    category: asset.category,
    status: asset.status,
    assetTag: asset.assetTag,
    serialNumber: asset.serialNumber ?? '',
    model: asset.model ?? '',
    purchaseDate: asset.purchaseDate ?? '',
    price: centsToInputValue(asset.purchasePriceCents),
    supplier: asset.supplier ?? '',
    warrantyUntil: asset.warrantyUntil ?? '',
    notes: asset.notes ?? '',
    customValues: Object.fromEntries(customFields.map((field) => [field.key, field.value ?? ''])),
  };
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim());

/**
 * One form for creating and editing an asset — the design only draws the
 * create modal, and an edit that looked different would be a second thing to
 * keep in sync. Assigning is deliberately absent from edit mode: moving an
 * asset in or out of `assigned` is what assign and check-in are for.
 */
export function AssetFormModal({
  asset,
  customFields,
  role,
  onClose,
  onDeleted,
}: {
  /** Absent for a create. */
  asset?: Asset;
  customFields?: CustomFieldValue[];
  role: Role;
  onClose: () => void;
  /** Where to go once the asset is gone; defaults to just closing. */
  onDeleted?: () => void;
}) {
  const editing = asset !== undefined;
  const [form, setForm] = useState<FormState>(
    editing ? fromAsset(asset, customFields ?? []) : EMPTY,
  );
  const [createAnother, setCreateAnother] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toast = useToast();
  const defs = useCustomFields();
  const employees = useEmployees();
  const nextTag = useNextAssetTag(!editing);
  const create = useCreateAsset();
  // In create mode there is no asset to update and this hook is never fired;
  // it still needs a string to build a URL from.
  const update = useUpdateAsset(asset?.id ?? '');
  const remove = useDeleteAsset();

  const pending = create.isPending || update.isPending || remove.isPending;
  // Whichever of the three ran is the one that can have failed — this picks the
  // failure that exists rather than defaulting to anything.
  const errors = fieldErrors(create.error ?? update.error);
  const failure = create.error ?? update.error ?? remove.error;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // The suggestion only fills an untouched field, so a typed tag survives it.
  const tagValue = form.assetTag || (editing ? '' : (nextTag.data ?? ''));
  const holderLocked = editing && asset.status === 'assigned';
  // A create may start an asset out as assigned (it opens the first ownership
  // record); an edit may not move one in or out of that status.
  const statusOptions = ASSET_STATUSES.filter(
    (status) => !editing || status !== 'assigned' || form.status === 'assigned',
  );

  // `defs.data ?? []` throughout: definitions that have not loaded are no
  // definitions to render, and a field never typed into has no entry.
  const customValuesPayload = () =>
    Object.fromEntries(
      (defs.data ?? []).map((def) => [def.key, blankToNull(form.customValues[def.key] ?? '')]),
    );

  function reset() {
    setForm(EMPTY);
    setPriceError(null);
    nextTag.refetch();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const price = parsePriceToCents(form.price);
    if (!price.ok) {
      setPriceError(price.reason);
      return;
    }
    setPriceError(null);

    const shared = {
      name: form.name,
      category: form.category,
      model: blankToNull(form.model),
      serialNumber: blankToNull(form.serialNumber),
      purchaseDate: blankToNull(form.purchaseDate),
      purchasePriceCents: price.cents,
      supplier: blankToNull(form.supplier),
      warrantyUntil: blankToNull(form.warrantyUntil),
      notes: blankToNull(form.notes),
      customValues: customValuesPayload(),
    };

    if (editing) {
      update.mutate(
        { ...shared, status: form.status, assetTag: tagValue },
        {
          onSuccess: () => {
            toast.show('Asset saved.', 'ok');
            onClose();
          },
        },
      );
      return;
    }

    create.mutate(
      {
        ...shared,
        status: form.status,
        assetTag: tagValue || undefined,
        currency: null,
        assignedToEmployeeId:
          form.status === 'assigned' ? blankToNull(form.assignedToEmployeeId) : null,
        checkoutDate: form.status === 'assigned' ? blankToNull(form.checkoutDate) : null,
      },
      {
        onSuccess: ({ asset: created }) => {
          toast.show(`${created.assetTag} added to the inventory.`, 'ok');
          if (createAnother) reset();
          else onClose();
        },
      },
    );
  }

  return (
    <Modal
      title={editing ? 'Edit asset' : 'New asset'}
      subtitle={editing ? 'Update the device record' : 'Register a device in the inventory'}
      width={560}
      topOffset="6vh"
      maxHeight="86vh"
      onClose={onClose}
      footer={
        <>
          <div className={styles.footerLeft}>
            <span className={styles.required}>* Required</span>
            {editing && can(role, 'assets.delete') && (
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  remove.mutate(asset.id, {
                    onSuccess: () => {
                      toast.show(`${asset.assetTag} deleted.`, 'ok');
                      (onDeleted ?? onClose)();
                    },
                  });
                }}
              >
                {confirmingDelete ? 'Confirm delete' : 'Delete asset'}
              </Button>
            )}
          </div>
          {!editing && (
            <Checkbox
              className={styles.another}
              label="Create another"
              checked={createAnother}
              onChange={(event) => setCreateAnother(event.target.checked)}
            />
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="asset-form" disabled={pending}>
            {editing ? 'Save changes' : 'Create asset'}
          </Button>
        </>
      }
    >
      <form id="asset-form" className={styles.form} onSubmit={submit} noValidate>
        {failure && !Object.keys(errors).length && (
          <div className={styles.formError} role="alert">
            {failure.message}
          </div>
        )}

        <Field label="Name" required error={errors.name}>
          {(id) => (
            <Input
              id={id}
              value={form.name}
              placeholder={'e.g. MacBook Pro 14" M3'}
              onChange={(event) => set('name', event.target.value)}
              autoFocus
            />
          )}
        </Field>

        <div className={styles.pair}>
          <Field label="Category" required error={errors.category}>
            {(id) => (
              <Select
                id={id}
                value={form.category}
                onChange={(event) => set('category', event.target.value as AssetCategory)}
              >
                {ASSET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {ASSET_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Status"
            required
            error={errors.status}
            hint={holderLocked ? 'Check the asset in to change its status.' : undefined}
          >
            {(id) => (
              <Select
                id={id}
                value={form.status}
                disabled={holderLocked}
                onChange={(event) => set('status', event.target.value as AssetStatus)}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {ASSET_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Asset tag" hint="Auto-generated — editable" error={errors.assetTag}>
            {(id) => (
              <Input
                id={id}
                mono
                value={tagValue}
                placeholder="AST-0224"
                onChange={(event) => set('assetTag', event.target.value)}
              />
            )}
          </Field>

          <Field label="Serial number" error={errors.serialNumber}>
            {(id) => (
              <Input
                id={id}
                mono
                value={form.serialNumber}
                placeholder="e.g. C02XK1AZQ6L7"
                onChange={(event) => set('serialNumber', event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Model" error={errors.model}>
          {(id) => (
            <Input
              id={id}
              value={form.model}
              placeholder="e.g. A2779 · M3 Pro"
              onChange={(event) => set('model', event.target.value)}
            />
          )}
        </Field>

        {!editing && form.status === 'assigned' && (
          <div className={styles.pair}>
            <Field
              label="Assigned to"
              required
              hint="Creates the first ownership record"
              error={errors.assignedToEmployeeId}
            >
              {(id) => (
                <Select
                  id={id}
                  value={form.assignedToEmployeeId}
                  onChange={(event) => set('assignedToEmployeeId', event.target.value)}
                >
                  <option value="">— Choose an employee —</option>
                  {(employees.data ?? [])
                    .filter((employee) => employee.status === 'active')
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.displayName}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Checkout date" hint="Defaults to today" error={errors.checkoutDate}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={form.checkoutDate}
                  onChange={(event) => set('checkoutDate', event.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        <div className={styles.pair}>
          <Field label="Purchase date" error={errors.purchaseDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.purchaseDate}
                onChange={(event) => set('purchaseDate', event.target.value)}
              />
            )}
          </Field>
          {/* A price we could not read locally never reached the server, so
              there is no server message to prefer over it. */}
          <Field label="Purchase price" error={priceError ?? errors.purchasePriceCents}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={form.price}
                placeholder="0.00"
                onChange={(event) => set('price', event.target.value)}
              />
            )}
          </Field>
          <Field label="Supplier" error={errors.supplier}>
            {(id) => (
              <Input
                id={id}
                value={form.supplier}
                placeholder="e.g. Insight EMEA"
                onChange={(event) => set('supplier', event.target.value)}
              />
            )}
          </Field>
          <Field label="Warranty until" error={errors.warrantyUntil}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.warrantyUntil}
                onChange={(event) => set('warrantyUntil', event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Notes" error={errors.notes}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={form.notes}
              placeholder="Anything worth remembering about this device"
              onChange={(event) => set('notes', event.target.value)}
            />
          )}
        </Field>

        {(defs.data ?? []).length > 0 && (
          <div className={styles.custom}>
            <div className={styles.customTitle}>Custom fields</div>
            {(defs.data ?? []).map((def) =>
              def.type === 'boolean' ? (
                <Checkbox
                  key={def.key}
                  label={def.label}
                  checked={form.customValues[def.key] === 'true'}
                  onChange={(event) =>
                    set('customValues', {
                      ...form.customValues,
                      [def.key]: event.target.checked ? 'true' : '',
                    })
                  }
                />
              ) : (
                <Field key={def.key} label={def.label}>
                  {(id) => (
                    <Input
                      id={id}
                      type={def.type === 'date' ? 'date' : 'text'}
                      inputMode={def.type === 'number' ? 'decimal' : undefined}
                      value={form.customValues[def.key] ?? ''}
                      onChange={(event) =>
                        set('customValues', {
                          ...form.customValues,
                          [def.key]: event.target.value,
                        })
                      }
                    />
                  )}
                </Field>
              ),
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
