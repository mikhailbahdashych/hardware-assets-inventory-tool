import { useMemo, useState, type FormEvent } from 'react';
import type { AssignInput } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useAssignAsset } from '@/api/mutations';
import { PICKER_PAGE, useAssets, useEmployees, useWorkflow } from '@/api/queries';
import {
  Avatar,
  Button,
  ErrorState,
  Field,
  Input,
  Modal,
  SearchInput,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { statusInfo, statusMap } from '@/lib/workflow';
import { useToast } from '@/providers/ToastProvider';
import type { AssignModalProps, Candidate } from './types/assignModal';
import formStyles from '@/components/ui/FormModal.module.css';
import styles from './Assign.module.css';

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

  const toast = useToast();
  // The candidate list is searched on the server now — the lists are pages, so
  // a modal that filtered whatever it happened to hold would offer a fraction
  // of the people. One small page, refetched as the typing settles. Only the
  // side this mode is picking from carries the needle; the other keeps a stable
  // key and so is fetched once rather than on every keystroke.
  const needle = useDebouncedValue(query).trim();
  const picker = (side: boolean) => ({
    q: side && needle !== '' ? needle : undefined,
    limit: PICKER_PAGE,
    offset: 0,
  });
  const employees = useEmployees(picker(mode === 'pick-employee'));
  // `assignable` asks the API for only what a handover may start from — most of
  // a healthy inventory is assigned, so a page of twenty taken first and
  // filtered afterwards would usually be a page of nothing.
  const assets = useAssets({ ...picker(mode === 'pick-asset'), assignable: true });
  const workflow = useWorkflow();
  // In pick-asset mode the chosen row *is* the asset, so the endpoint is only
  // known once something is selected — until then there is no asset to name,
  // and the submit button is disabled anyway.
  const targetAssetId = props.mode === 'pick-employee' ? props.assetId : (selected ?? '');
  const assign = useAssignAsset(targetAssetId);
  const errors = fieldErrors(assign.error);

  /**
   * The picker's own failure. Only the side this mode picks from is drawn, so
   * only its reads can fail it — the other list is never rendered, and the
   * rule's own clause covers that: a query whose failure changes nothing on
   * screen is not this surface's failure. The workflow counts on the asset
   * side, where it writes every row's status into the subtitle.
   */
  const failure = (() => {
    if (mode === 'pick-employee') return employees.isError ? employees.error : null;
    if (assets.isError) return assets.error;
    return workflow.isError ? workflow.error : null;
  })();

  function retry(): void {
    if (mode === 'pick-employee') {
      void employees.refetch();
      return;
    }
    void assets.refetch();
    void workflow.refetch();
  }

  /**
   * Whether the list below is showing an answer at all. **A retyped needle is a
   * new read**, and `placeholderData` has nothing to carry forward from one
   * that failed — so the list goes plainly pending between a failed search and
   * its failed replacement, and "nothing matches" is a fact about the workspace
   * that nobody has checked yet. Three states here too, and the empty sentence
   * belongs to exactly one of them.
   */
  const answered =
    mode === 'pick-employee' ? employees.isSuccess : assets.isSuccess && workflow.isSuccess;

  const candidates = useMemo<Candidate[]>(() => {
    // Failed, then not here yet — and in the last branch `data` is defined, so
    // there is nothing left to coalesce. After a failure the rows that arrived
    // last are not an answer either: this modal cannot say they are still
    // assignable, and the panel below is what says so instead.
    if (failure !== null) return [];
    if (mode === 'pick-employee') {
      if (!employees.isSuccess) return [];
      return (
        employees.data.employees
          // Employee status is not a filter the list endpoint takes, so this one
          // stays here. It thins a page rather than emptying it: somebody
          // offboarding is a small minority, unlike an assigned asset. Give the
          // endpoint a status filter if that ever stops being true.
          .filter((employee) => employee.status === 'active')
          .map((employee) => ({
            id: employee.id,
            title: employee.displayName,
            subtitle: [employee.jobTitle, employee.location].filter(Boolean).join(' · ') || '—',
            avatarKey: employee.id,
          }))
      );
    }
    if (!assets.isSuccess || !workflow.isSuccess) return [];
    // The filtering itself is the API's, through `assignable` above.
    const byId = statusMap(workflow.data.statuses);
    return assets.data.assets.map((asset) => ({
      id: asset.id,
      title: asset.name,
      subtitle: `${asset.assetTag} · ${statusInfo(byId, asset.status).label}`,
      avatarKey: asset.id,
      square: true as const,
    }));
  }, [
    mode,
    failure,
    employees.data,
    employees.isSuccess,
    assets.data,
    assets.isSuccess,
    workflow.data,
    workflow.isSuccess,
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;

    const input: AssignInput = {
      employeeId: props.mode === 'pick-employee' ? selected : props.employeeId,
      checkoutDate,
      expectedReturnDate: expectedReturnDate || null,
      notes: notes.trim() || null,
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
            {/* The search box stays above whichever of these it is — it is
                how you ask again — but "nothing matches" is a fact about the
                workspace and may not stand in for a read that never answered. */}
            <div className={styles.list} role="listbox" aria-label="Candidates">
              {failure !== null ? (
                <ErrorState error={failure} onRetry={retry}>
                  {mode === 'pick-employee'
                    ? 'The people this asset could go to could not be loaded.'
                    : 'The assets available to hand out could not be loaded.'}
                </ErrorState>
              ) : !answered ? (
                <div className={styles.empty}>
                  <Spinner size={16} />
                </div>
              ) : (
                candidates.length === 0 && (
                  <div className={styles.empty}>
                    {mode === 'pick-employee'
                      ? 'No active employee matches that.'
                      : 'Nothing available to hand out.'}
                  </div>
                )
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
      </form>
    </Modal>
  );
}
