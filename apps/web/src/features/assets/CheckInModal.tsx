import { useState, type FormEvent } from 'react';
import {
  CHECKIN_CONDITION_LABELS,
  CHECKIN_CONDITIONS,
  type CheckinCondition,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCheckinAsset } from '@/api/mutations';
import { useWorkflow } from '@/api/queries';
import { Button, Dropdown, Field, Input, Modal, SegmentedControl, Textarea } from '@/components/ui';
import { NotifyCheckbox } from '@/components/app/NotifyCheckbox';
import { checkinTargets } from '@/lib/workflow';
import { useToast } from '@/providers/ToastProvider';
import type { CheckInModalProps } from './types/checkInModal';
import formStyles from '@/components/ui/FormModal.module.css';

/**
 * Taking an asset back: closes the ownership record and lands the device.
 *
 * Where it may land is a workspace decision — the statuses flagged as check-in
 * targets, in the workspace's order. The old "Return to stock" wording for
 * `available` is gone with the enum: a label an admin chose speaks for itself.
 */
export function CheckInModal({ asset, onClose }: CheckInModalProps) {
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [condition, setCondition] = useState<CheckinCondition>('good');
  const [chosen, setChosen] = useState('');
  const [notes, setNotes] = useState('');
  const [emailConfirmation, setEmailConfirmation] = useState(false);

  const toast = useToast();
  const workflow = useWorkflow();
  const checkin = useCheckinAsset(asset.id);
  const errors = fieldErrors(checkin.error);

  // Destinations that have not arrived are none to offer; the first one is the
  // default until somebody picks another, so the choice cannot live in state.
  const destinations = checkinTargets(workflow.data?.statuses ?? []);
  const newStatus = chosen || (destinations[0]?.id ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    checkin.mutate(
      { returnDate, newStatus, condition, notes: notes.trim() || null, emailConfirmation },
      {
        onSuccess: ({ asset: updated }) => {
          toast.show(`${updated.assetTag} checked in.`, 'ok');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title={`Check in ${asset.assetTag}`}
      subtitle={
        asset.currentHolder ? `Returning from ${asset.currentHolder.name}` : 'Return this device'
      }
      width={460}
      topOffset="10vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose} disabled={checkin.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="checkin-form"
            disabled={checkin.isPending || newStatus === ''}
          >
            Check in asset
          </Button>
        </>
      }
    >
      <form id="checkin-form" className={formStyles.form} onSubmit={submit} noValidate>
        {checkin.error && !Object.keys(errors).length && (
          <div className={formStyles.formError} role="alert">
            {checkin.error.message}
          </div>
        )}

        <div className={formStyles.pair}>
          <Field label="Return date" required error={errors.returnDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
              />
            )}
          </Field>
          <Field label="Condition" error={errors.condition}>
            {(id) => (
              <Dropdown
                id={id}
                value={condition}
                options={CHECKIN_CONDITIONS.map((value) => ({
                  value,
                  label: CHECKIN_CONDITION_LABELS[value],
                }))}
                onChange={setCondition}
              />
            )}
          </Field>
        </div>

        <Field label="New status" required error={errors.newStatus}>
          {destinations.length === 0 ? (
            <p className={formStyles.empty}>
              This workspace has no status for a returning asset to land in.
            </p>
          ) : (
            <SegmentedControl
              options={destinations.map((status) => ({ value: status.id, label: status.label }))}
              value={newStatus}
              onChange={setChosen}
              grow
            />
          )}
        </Field>

        <Field label="Notes" error={errors.notes}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={notes}
              placeholder="e.g. returned with charger, minor scratches on lid"
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>

        {asset.currentHolder && (
          <NotifyCheckbox
            checked={emailConfirmation}
            onChange={setEmailConfirmation}
            label={`Email confirmation to ${asset.currentHolder.name}`}
          />
        )}
      </form>
    </Modal>
  );
}
