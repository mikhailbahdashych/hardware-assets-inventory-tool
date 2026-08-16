import { useState, type FormEvent } from 'react';
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  canDirectlyTransition,
  type AssetStatus,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useUpdateAsset } from '@/api/mutations';
import type { Asset } from '@/api/types';
import { Button, Field, Modal, Select } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import formStyles from '@/components/ui/FormModal.module.css';

/**
 * The design routes this button to Assign, which is a bug: an asset that is
 * In repair or Ordered has no holder to change. It gets its own small modal,
 * offering only the moves `canDirectlyTransition` allows.
 */
export function ChangeStatusModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const options = ASSET_STATUSES.filter((status) => canDirectlyTransition(asset.status, status));
  const [status, setStatus] = useState<AssetStatus>(options[0] ?? asset.status);

  const toast = useToast();
  const update = useUpdateAsset(asset.id);
  const errors = fieldErrors(update.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      { status },
      {
        onSuccess: ({ asset: updated }) => {
          toast.show(`${updated.assetTag} is now ${ASSET_STATUS_LABELS[updated.status]}.`, 'ok');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title={`Change status · ${asset.assetTag}`}
      subtitle="Where this device stands, without changing who holds it"
      width={420}
      topOffset="14vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>Currently {ASSET_STATUS_LABELS[asset.status]}</span>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="status-form" disabled={update.isPending}>
            Change status
          </Button>
        </>
      }
    >
      <form id="status-form" className={formStyles.form} onSubmit={submit} noValidate>
        {update.error && !Object.keys(errors).length && (
          <div className={formStyles.formError} role="alert">
            {update.error.message}
          </div>
        )}
        <Field
          label="New status"
          required
          hint="Assign and check in are what move an asset in and out of Assigned."
          error={errors.status}
        >
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(event) => setStatus(event.target.value as AssetStatus)}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {ASSET_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}
