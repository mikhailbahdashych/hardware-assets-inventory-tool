import { useState, type FormEvent } from 'react';
import {
  CHECKIN_CONDITION_LABELS,
  CHECKIN_CONDITIONS,
  CHECKIN_NEW_STATUS_LABELS,
  CHECKIN_NEW_STATUSES,
  type CheckinCondition,
  type CheckinNewStatus,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCheckinAsset } from '@/api/mutations';
import type { Asset } from '@/types/api';
import { Button, Field, Input, Modal, SegmentedControl, Select, Textarea } from '@/components/ui';
import { NotifyCheckbox } from '@/components/app/NotifyCheckbox';
import { useToast } from '@/providers/ToastProvider';
import formStyles from '@/components/ui/FormModal.module.css';

/** Everything check-in needs to know: which asset, and who has it. */
export type CheckinSubject = Pick<Asset, 'id' | 'assetTag' | 'currentHolder'>;

const STATUS_OPTIONS = CHECKIN_NEW_STATUSES.map((status) => ({
  value: status,
  label: CHECKIN_NEW_STATUS_LABELS[status],
}));

/** Taking an asset back: closes the ownership record and lands the device. */
export function CheckInModal({ asset, onClose }: { asset: CheckinSubject; onClose: () => void }) {
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [condition, setCondition] = useState<CheckinCondition>('good');
  const [newStatus, setNewStatus] = useState<CheckinNewStatus>('available');
  const [notes, setNotes] = useState('');
  const [emailConfirmation, setEmailConfirmation] = useState(false);

  const toast = useToast();
  const checkin = useCheckinAsset(asset.id);
  const errors = fieldErrors(checkin.error);

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
          <Button type="submit" form="checkin-form" disabled={checkin.isPending}>
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
              <Select
                id={id}
                value={condition}
                onChange={(event) => setCondition(event.target.value as CheckinCondition)}
              >
                {CHECKIN_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {CHECKIN_CONDITION_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="New status" required error={errors.newStatus}>
          <SegmentedControl
            options={STATUS_OPTIONS}
            value={newStatus}
            onChange={setNewStatus}
            grow
          />
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
