import { useMemo, useState, type FormEvent } from 'react';
import { ASSET_STATUS_LABELS, type AssignInput } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useAssignAsset } from '@/api/mutations';
import { useAssets, useEmployees } from '@/api/queries';
import { Avatar, Button, Field, Input, Modal, SearchInput, Textarea } from '@/components/ui';
import { NotifyCheckbox } from '@/components/app/NotifyCheckbox';
import { useToast } from '@/providers/ToastProvider';
import formStyles from '@/components/ui/FormModal.module.css';
import styles from './Assign.module.css';

interface Candidate {
  id: string;
  title: string;
  subtitle: string;
  avatarKey: string;
  square?: true;
}

/**
 * The known half of the pair, as a union rather than four optional props: in
 * pick-employee mode the asset is always known, in pick-asset mode the person
 * is. Optional props would have made every read of them a fallback over a
 * value that is in fact always there.
 */
type AssignModalProps = { onClose: () => void } & (
  | { mode: 'pick-employee'; assetId: string; assetName: string }
  | { mode: 'pick-asset'; employeeId: string; employeeName: string }
);

/**
 * The design's two-mode assign modal: from an asset you pick a person, from a
 * person you pick an asset. Both end in the same POST, so the mode only
 * decides which side of the pair is already known.
 */
export function AssignModal(props: AssignModalProps) {
  const { mode, onClose } = props;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [checkoutDate, setCheckoutDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [notes, setNotes] = useState('');
  const [notify, setNotify] = useState(false);

  const toast = useToast();
  const employees = useEmployees();
  const assets = useAssets();
  // In pick-asset mode the chosen row *is* the asset, so the endpoint is only
  // known once something is selected — until then there is no asset to name,
  // and the submit button is disabled anyway.
  const targetAssetId = props.mode === 'pick-employee' ? props.assetId : (selected ?? '');
  const assign = useAssignAsset(targetAssetId);
  const errors = fieldErrors(assign.error);

  const candidates = useMemo<Candidate[]>(() => {
    const needle = query.trim().toLowerCase();
    // A list that has not arrived offers no candidates, and a person with no
    // department recorded matches nothing rather than everything.
    if (mode === 'pick-employee') {
      return (employees.data ?? [])
        .filter((employee) => employee.status === 'active')
        .filter((employee) =>
          [employee.displayName, employee.department ?? '', employee.jobTitle ?? ''].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
        .map((employee) => ({
          id: employee.id,
          title: employee.displayName,
          subtitle: [employee.jobTitle, employee.location].filter(Boolean).join(' · ') || '—',
          avatarKey: employee.id,
        }));
    }
    return (assets.data ?? [])
      .filter((asset) => asset.status === 'available' || asset.status === 'ordered')
      .filter((asset) =>
        [asset.name, asset.assetTag].some((field) => field.toLowerCase().includes(needle)),
      )
      .map((asset) => ({
        id: asset.id,
        title: asset.name,
        subtitle: `${asset.assetTag} · ${ASSET_STATUS_LABELS[asset.status]}`,
        avatarKey: asset.id,
        square: true as const,
      }));
  }, [mode, query, employees.data, assets.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;

    const input: AssignInput = {
      employeeId: props.mode === 'pick-employee' ? selected : props.employeeId,
      checkoutDate,
      expectedReturnDate: expectedReturnDate || null,
      notes: notes.trim() || null,
      notify,
    };
    assign.mutate(input, {
      onSuccess: ({ asset }) => {
        toast.show(`${asset.assetTag} handed over.`, 'ok');
        onClose();
      },
    });
  }

  return (
    <Modal
      title={props.mode === 'pick-employee' ? `Assign ${props.assetName}` : 'Assign asset'}
      subtitle={
        props.mode === 'pick-employee'
          ? 'Hand this device to somebody'
          : `Give ${props.employeeName} a device`
      }
      width={480}
      topOffset="8vh"
      maxHeight="84vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="assign-form" disabled={assign.isPending || !selected}>
            Assign asset
          </Button>
        </>
      }
    >
      <form id="assign-form" className={formStyles.form} onSubmit={submit} noValidate>
        {assign.error && !Object.keys(errors).length && (
          <div className={formStyles.formError} role="alert">
            {assign.error.message}
          </div>
        )}

        <Field
          label={mode === 'pick-employee' ? 'Assign to' : 'Asset'}
          required
          error={errors.employeeId}
        >
          <div className={styles.picker}>
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === 'pick-employee'
                  ? 'Search people by name or department…'
                  : 'Search available assets by name or tag…'
              }
              width="100%"
              aria-label={mode === 'pick-employee' ? 'Search people' : 'Search assets'}
            />
            <div className={styles.list} role="listbox" aria-label="Candidates">
              {candidates.length === 0 && (
                <div className={styles.empty}>
                  {mode === 'pick-employee'
                    ? 'No active employee matches that.'
                    : 'Nothing available to hand out.'}
                </div>
              )}
              {candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="option"
                  aria-selected={selected === candidate.id}
                  className={styles.option}
                  data-selected={selected === candidate.id}
                  onClick={() => setSelected(candidate.id)}
                >
                  <Avatar
                    name={candidate.title}
                    colorKey={candidate.avatarKey}
                    size={24}
                    square={candidate.square}
                  />
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>{candidate.title}</span>
                    <span className={styles.optionSub}>{candidate.subtitle}</span>
                  </span>
                  {selected === candidate.id && <span className={styles.selected}>Selected</span>}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <div className={formStyles.pair}>
          <Field label="Checkout date" required error={errors.checkoutDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={checkoutDate}
                onChange={(event) => setCheckoutDate(event.target.value)}
              />
            )}
          </Field>
          <Field label="Expected return" error={errors.expectedReturnDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={expectedReturnDate}
                onChange={(event) => setExpectedReturnDate(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Notes" error={errors.notes}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={notes}
              placeholder="e.g. includes charger and USB-C hub"
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>

        <NotifyCheckbox
          checked={notify}
          onChange={setNotify}
          label="Email the assignee about this device"
        />
      </form>
    </Modal>
  );
}
