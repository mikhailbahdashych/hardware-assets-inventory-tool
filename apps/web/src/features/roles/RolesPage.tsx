import { useState } from 'react';
import { ACTION_GROUPS, ACTION_LABELS, type Action, type WorkspaceRole } from '@inventory/shared';
import { useReorderRoles, useSaveRolePermissions } from '@/api/mutations';
import { useRoles } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, Checkbox, DataTable, IconButton, Pill, Spinner } from '@/components/ui';
import type { TableColumn } from '@/types/table';
import { useToast } from '@/providers/ToastProvider';
import { DeleteRoleModal } from './DeleteRoleModal';
import { RoleFormModal } from './RoleFormModal';
import { draftChanged, draftFromRoles, draftKey, grantsFromDraft } from './rolesDraft';
import type {
  MatrixRow,
  PermissionsCardProps,
  RolesCardProps,
  RolesPageProps,
} from './types/rolesPage';
import styles from './Roles.module.css';

/**
 * Who this workspace has, and what each of them may do.
 *
 * Roles used to be an enum compiled into both apps, ranked so that an admin
 * outranked a manager outranked a viewer; they are rows with their own grant
 * sets now, and this is where they are edited. Behind `roles.manage` — enforced
 * by the route guard in routes.tsx, and by the same action on every endpoint
 * underneath.
 */
export function RolesPage({ ownRole }: RolesPageProps) {
  const roles = useRoles();

  return (
    <PageContainer maxWidth={1060} gap={16}>
      <div>
        <h1 className={styles.title}>Roles</h1>
        <p className={styles.summary}>
          The roles this workspace has, and what each of them may do · nobody may edit the role they
          hold
        </p>
      </div>
      {roles.data === undefined ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <>
          <RolesCard roles={roles.data.roles} ownRole={ownRole} />
          {/* Keyed on the stored grants, so a save — this admin's or anybody
              else's — re-seeds the draft instead of leaving stale boxes on
              screen. The same trick the transition matrix plays. */}
          <PermissionsCard
            key={[...draftFromRoles(roles.data.roles)].sort().join()}
            roles={roles.data.roles}
            ownRole={ownRole}
          />
        </>
      )}
    </PageContainer>
  );
}

/**
 * One row per role, in the workspace's own order. The member count is on the
 * row rather than in the delete modal because this card is the one place it can
 * be read down a column — which role a workspace actually runs on, and which
 * one nobody has been given yet.
 */
function RolesCard({ roles, ownRole }: RolesCardProps) {
  const [editing, setEditing] = useState<WorkspaceRole | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceRole | null>(null);

  const toast = useToast();
  const reorder = useReorderRoles();
  const order = roles.map((role) => role.id);

  /** Reordering sends every id, so the list the server keeps is always whole. */
  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    const [moved] = next.splice(index, 1);
    // `index` comes from the list being rendered, so the splice returns a row.
    if (moved === undefined) throw new Error('A role row was reordered off the end of the list.');
    next.splice(index + by, 0, moved);
    reorder.mutate(next, { onError: (error) => toast.show(error.message, 'err') });
  };

  const columns: TableColumn<WorkspaceRole>[] = [
    {
      header: 'Role',
      width: 'minmax(130px, 1fr)',
      render: (role) => (
        <Pill sv={role.color} dot>
          {role.label}
        </Pill>
      ),
    },
    {
      header: 'Description',
      width: 'minmax(200px, 2.2fr)',
      // A nullable column, and the design's em dash for an empty cell.
      render: (role) => <span className={styles.muted}>{role.description ?? '—'}</span>,
    },
    {
      header: 'Held by',
      width: '110px',
      render: (role) => (
        <span className={styles.muted}>
          {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'}
        </span>
      ),
    },
    {
      header: 'Order',
      width: '76px',
      render: (role) => {
        const index = order.indexOf(role.id);
        return (
          <span className={styles.rowActions}>
            <IconButton
              icon="chevronUp"
              label={`Move ${role.label} up`}
              size={26}
              disabled={index === 0 || reorder.isPending}
              onClick={() => move(index, -1)}
            />
            <IconButton
              icon="chevronDown"
              label={`Move ${role.label} down`}
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
      render: (role) => {
        // The system role has neither: Admin is what keeps a workspace
        // administrable, so its words, its colour and its grants are all fixed.
        if (role.isSystem) return null;
        // Your own role is not yours to edit or delete — the API refuses too,
        // and that refusal is what stops a quiet self-promotion.
        const own = role.id === ownRole;
        const hint = own ? ' — ask another admin' : '';
        return (
          <span className={styles.rowActions}>
            <IconButton
              icon="pencil"
              label={`Edit ${role.label}${hint}`}
              size={26}
              disabled={own}
              onClick={() => setEditing(role)}
            />
            <IconButton
              icon="trash"
              label={`Delete ${role.label}${hint}`}
              size={26}
              disabled={own}
              onClick={() => setDeleting(role)}
            />
          </span>
        );
      },
    },
  ];

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Roles</h2>
          <p className={styles.cardHint}>
            Every member holds one. Renaming is safe — accounts keep the id underneath.
          </p>
        </div>
        <Button icon="plus" onClick={() => setAdding(true)}>
          Add role
        </Button>
      </div>

      <DataTable columns={columns} rows={roles} rowKey={(role) => role.id} label="Roles" />

      {adding && <RoleFormModal onClose={() => setAdding(false)} />}
      {editing && <RoleFormModal role={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <DeleteRoleModal
          role={deleting}
          // Anywhere but here. Admin is on the list: handing somebody full
          // access is a choice an admin may make, and the alternative is a
          // delete they cannot finish.
          destinations={roles.filter((role) => role.id !== deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

/**
 * Every action the product has, as a grid of checkboxes: a row is something a
 * person can do, a column is a role that may or may not do it. The whole thing
 * is one draft in local state and Save sends every grant — which is what a grid
 * of checkboxes naturally holds, and what makes the operation idempotent.
 *
 * The diff against the stored set is also the dirty check, so the button and
 * the payload cannot disagree; the same reasoning as the settings form, which
 * says why at length in apps/web/CLAUDE.md.
 *
 * Two columns are never editable. The system role's is ticked throughout,
 * because its set is every action by definition; the caller's own is locked,
 * because nobody may widen the role they hold.
 */
function PermissionsCard({ roles, ownRole }: PermissionsCardProps) {
  const stored = draftFromRoles(roles);
  const [draft, setDraft] = useState<Set<string>>(stored);

  const toast = useToast();
  const save = useSaveRolePermissions();
  const dirty = draftChanged(stored, draft);

  const toggle = (role: string, action: Action) =>
    setDraft((current) => {
      const next = new Set(current);
      const key = draftKey(role, action);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** A band per area, then the actions under it — in the order shared lists them. */
  const rows: MatrixRow[] = ACTION_GROUPS.flatMap((group) => [
    { kind: 'group', key: `group:${group.label}`, label: group.label },
    ...group.actions.map((action): MatrixRow => ({ kind: 'action', key: action, action })),
  ]);

  const columns: TableColumn<MatrixRow>[] = [
    {
      header: 'Action',
      width: 'minmax(200px, 1.6fr)',
      render: (row) =>
        row.kind === 'group' ? (
          <span className={styles.groupLabel}>{row.label}</span>
        ) : (
          ACTION_LABELS[row.action]
        ),
    },
    ...roles.map((role): TableColumn<MatrixRow> => {
      const own = role.id === ownRole;
      return {
        header: <span className={styles.cell}>{role.label}</span>,
        // 72px holds a checkbox under a role's name; ten of them beside the
        // action column still fit the 1060 the page is drawn at, and the
        // column only stretches from here.
        width: 'minmax(72px, 1fr)',
        render: (row) => {
          if (row.kind === 'group') return null;
          return (
            <span className={styles.cell}>
              <Checkbox
                // The box is the whole control; its name is the grant it stands for.
                label={null}
                aria-label={`${role.label}: ${ACTION_LABELS[row.action]}${own ? ' — ask another admin' : ''}`} // prettier-ignore
                checked={role.isSystem || draft.has(draftKey(role.id, row.action))}
                disabled={role.isSystem || own || save.isPending}
                onChange={() => toggle(role.id, row.action)}
              />
            </span>
          );
        },
      };
    }),
  ];

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Permissions</h2>
          <p className={styles.cardHint}>
            A tick is permission to change something. Reading is open to everyone who can sign in,
            so a role with nothing ticked is a read-only one — and Admin holds every action there
            is, including the ones a later version adds.
          </p>
        </div>
        <div className={styles.actions}>
          <span className={styles.actionsNote}>
            {dirty ? 'Unsaved changes' : 'Everything here is saved'}
          </span>
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(stored)}
          >
            Discard
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(grantsFromDraft(draft), {
                onSuccess: () => toast.show('Permissions saved.', 'ok'),
                onError: (error) => toast.show(error.message, 'err'),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save permissions'}
          </Button>
        </div>
      </div>

      <div className={styles.matrix}>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.key} label="Permissions" />
      </div>
    </section>
  );
}
