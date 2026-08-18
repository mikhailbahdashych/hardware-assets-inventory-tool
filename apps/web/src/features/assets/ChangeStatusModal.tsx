import { useState, type FormEvent } from 'react';
import { fieldErrors } from '@/api/formErrors';
import { useUpdateAsset } from '@/api/mutations';
import { useWorkflow } from '@/api/queries';
import { Button, Dropdown, Field, Modal } from '@/components/ui';
import { allowedTargets, statusInfo, statusMap, EMPTY_WORKFLOW } from '@/lib/workflow';
import { useToast } from '@/providers/ToastProvider';
import type { ChangeStatusModalProps } from './types/changeStatusModal';
import formStyles from '@/components/ui/FormModal.module.css';

/**
 * The design routes this button to Assign, which is a bug: an asset that is
 * In repair or Ordered has no holder to change. It gets its own small modal,
 * offering exactly the moves the workspace's workflow has an edge for — so an
 * admin who removes a transition removes it from this list too, rather than
 * leaving a choice the API would refuse.
 */
export function ChangeStatusModal({ asset, onClose }: ChangeStatusModalProps) {
  const workflow = useWorkflow();
  // A workflow that has not arrived offers no moves; the empty state below
  // covers that moment as well as a status with nowhere to go.
  const payload = workflow.data ?? EMPTY_WORKFLOW;
  const byId = statusMap(payload.statuses);
  const options = allowedTargets(payload, asset.status);
  const current = statusInfo(byId, asset.status);

  const [chosen, setChosen] = useState('');
  // The first allowed move, until somebody picks another. The list arrives
  // with the query, so the choice cannot be made in `useState`.
  const status = chosen || (options[0]?.id ?? '');

  const toast = useToast();
  const update = useUpdateAsset(asset.id);
  const errors = fieldErrors(update.error);
  const target = options.find((option) => option.id === status);

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      { status },
      {
        onSuccess: ({ asset: updated }) => {
          toast.show(`${updated.assetTag} is now ${statusInfo(byId, updated.status).label}.`, 'ok');
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
          <span className={formStyles.required}>Currently {current.label}</span>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="status-form"
            disabled={update.isPending || target === undefined}
          >
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
        {options.length === 0 ? (
          <p className={formStyles.empty}>The workflow allows no moves from {current.label}.</p>
        ) : (
          <Field
            label="New status"
            required
            hint="Assign and check in are what move an asset in and out of Assigned."
            error={errors.status}
          >
            {(id) => (
              <Dropdown
                id={id}
                value={status}
                options={options.map((option) => ({ value: option.id, label: option.label }))}
                onChange={setChosen}
              />
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}
