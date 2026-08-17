import { useState } from 'react';
import { ASSIGNED_STATUS, type WorkflowStatus } from '@inventory/shared';
import { useReorderStatuses, useUpdateStatus } from '@/api/mutations';
import { useWorkflow } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, DataTable, IconButton, Pill, Spinner, ToggleSwitch } from '@/components/ui';
import type { TableColumn } from '@/types/table';
import { useToast } from '@/providers/ToastProvider';
import { DeleteStatusModal } from './DeleteStatusModal';
import { StatusFormModal } from './StatusFormModal';
import type { StatusesCardProps } from './types/workflowPage';
import styles from './Workflow.module.css';

/**
 * What this workspace can say about an asset, and what it may do next.
 *
 * Statuses used to be an enum compiled into both apps; they are rows now, and
 * this is where they are edited. Admins only — enforced by the route guard in
 * routes.tsx, and by `workflow.manage` on every endpoint underneath.
 */
export function WorkflowPage() {
  const workflow = useWorkflow();

  return (
    <PageContainer maxWidth={1060} gap={16}>
      <div>
        <h1 className={styles.title}>Workflow</h1>
        <p className={styles.summary}>
          The statuses this workspace uses, and the moves between them · visible to Admins only
        </p>
      </div>
      {workflow.data === undefined ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <StatusesCard statuses={workflow.data.statuses} />
      )}
    </PageContainer>
  );
}

/**
 * One row per status, in the workspace's own order. The two behaviour flags
 * are on the rows rather than in the form because this card is the one place
 * they can be read down a column: which statuses can be handed out, which a
 * returning asset may land in.
 */
function StatusesCard({ statuses }: StatusesCardProps) {
  const [editing, setEditing] = useState<WorkflowStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<WorkflowStatus | null>(null);

  const toast = useToast();
  const update = useUpdateStatus();
  const reorder = useReorderStatuses();
  const order = statuses.map((status) => status.id);

  /** One flag, one field: an absent key means "leave that one alone". */
  const setFlag = (
    status: WorkflowStatus,
    patch: { assignableFrom: boolean } | { checkinTarget: boolean },
  ) =>
    update.mutate(
      { id: status.id, ...patch },
      { onError: (error) => toast.show(error.message, 'err') },
    );

  /** Reordering sends every id, so the list the server keeps is always whole. */
  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    const [moved] = next.splice(index, 1);
    // `index` comes from the list being rendered, so the splice returns a row.
    if (moved === undefined) throw new Error('A status row was reordered off the end of the list.');
    next.splice(index + by, 0, moved);
    reorder.mutate(next, { onError: (error) => toast.show(error.message, 'err') });
  };

  const columns: TableColumn<WorkflowStatus>[] = [
    {
      header: 'Status',
      width: 'minmax(150px, 1.4fr)',
      render: (status) => (
        <Pill sv={status.color} dot>
          {status.label}
        </Pill>
      ),
    },
    {
      header: 'Can be handed out',
      width: '150px',
      render: (status) => (
        <ToggleSwitch
          label={`${status.label} can be handed out`}
          checked={status.assignableFrom}
          // Assign and check-in are the system status's only doors; a flag
          // would open a second one, and the API says so too.
          disabled={status.isSystem || update.isPending}
          onChange={(assignableFrom) => setFlag(status, { assignableFrom })}
        />
      ),
    },
    {
      header: 'Accepts check-ins',
      width: '140px',
      render: (status) => (
        <ToggleSwitch
          label={`${status.label} accepts check-ins`}
          checked={status.checkinTarget}
          disabled={status.isSystem || update.isPending}
          onChange={(checkinTarget) => setFlag(status, { checkinTarget })}
        />
      ),
    },
    {
      header: 'Order',
      width: '76px',
      render: (status) => {
        const index = order.indexOf(status.id);
        return (
          <span className={styles.rowActions}>
            <IconButton
              icon="chevronUp"
              label={`Move ${status.label} up`}
              size={26}
              disabled={index === 0 || reorder.isPending}
              onClick={() => move(index, -1)}
            />
            <IconButton
              icon="chevronDown"
              label={`Move ${status.label} down`}
              size={26}
              disabled={index === order.length - 1 || reorder.isPending}
              onClick={() => move(index, 1)}
            />
          </span>
        );
      },
    },
    {
      header: '',
      width: '70px',
      align: 'right',
      render: (status) => (
        <span className={styles.rowActions}>
          <IconButton
            icon="pencil"
            label={`Edit ${status.label}`}
            size={26}
            onClick={() => setEditing(status)}
          />
          {/* The system status has no delete: `assigned` is what makes
              "somebody holds this" a fact rather than a label. */}
          {!status.isSystem && (
            <IconButton
              icon="trash"
              label={`Delete ${status.label}`}
              size={26}
              onClick={() => setDeleting(status)}
            />
          )}
        </span>
      ),
    },
  ];

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Statuses</h2>
          <p className={styles.cardHint}>
            Every asset carries one. Renaming is safe — assets keep the id underneath.
          </p>
        </div>
        <Button icon="plus" onClick={() => setAdding(true)}>
          Add status
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={statuses}
        rowKey={(status) => status.id}
        label="Statuses"
      />

      {adding && <StatusFormModal onClose={() => setAdding(false)} />}
      {editing && <StatusFormModal status={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <DeleteStatusModal
          status={deleting}
          // Where its assets may go: any other status a plain asset can hold.
          // `assigned` is not one — an ownership record is what puts an asset
          // there, and a migration writes none.
          destinations={statuses.filter(
            (status) => status.id !== deleting.id && status.id !== ASSIGNED_STATUS,
          )}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
