import { useState } from 'react';
import { Link } from 'react-router';
import {
  can,
  MEMBER_STATUS_COLORS,
  MEMBER_STATUS_LABELS,
  ROLE_COLORS,
  ROLE_LABELS,
} from '@inventory/shared';
import { useIssueResetLink, useResendInvite } from '@/api/mutations';
import { useMembers } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Avatar, Button, DataTable, EmptyState, Menu, Pill, Spinner } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format';
import { useModals } from '@/providers/ModalProvider';
import { useToast } from '@/providers/ToastProvider';
import type { MemberSummary } from '@/types/api';
import type { TableColumn } from '@/types/table';
import { ChangeRoleModal } from './ChangeRoleModal';
import { CopyLinkModal } from './CopyLinkModal';
import { RemoveMemberModal } from './RemoveMemberModal';
import type { MembersDialog, MembersPageProps } from './types/membersPage';
import styles from './Members.module.css';

export function MembersPage({ role, memberId }: MembersPageProps) {
  const [dialog, setDialog] = useState<MembersDialog | null>(null);
  const toast = useToast();
  const { openModal } = useModals();
  const members = useMembers();
  const resend = useResendInvite();
  const reset = useIssueResetLink();
  const manages = can(role, 'members.manage');

  // A list that has not arrived has no rows; the empty state renders below.
  const rows = members.data ?? [];

  function rowActions(member: MemberSummary): MenuItem[] {
    const items: MenuItem[] = [];
    if (member.status === 'invited') {
      items.push({
        label: 'Resend invitation',
        onSelect: () =>
          resend.mutate(member.id, {
            onSuccess: ({ inviteUrl }) =>
              setDialog({
                kind: 'link',
                title: 'New invitation link',
                subtitle: `The previous link for ${member.email} no longer works`,
                label: 'Invitation link',
                url: inviteUrl,
              }),
            onError: (error) => toast.show(error.message, 'err'),
          }),
      });
    } else {
      items.push({
        label: 'Copy password reset link',
        onSelect: () =>
          reset.mutate(member.id, {
            onSuccess: ({ resetUrl }) =>
              setDialog({
                kind: 'link',
                title: 'Reset link ready',
                subtitle: `Hand this to ${member.displayName} yourself`,
                label: 'Password reset link',
                url: resetUrl,
              }),
            onError: (error) => toast.show(error.message, 'err'),
          }),
      });
    }

    // Your own account is not yours to demote or delete — the API refuses too,
    // and that refusal is what keeps an admin in the workspace.
    if (member.id !== memberId) {
      items.push({ label: 'Change role', onSelect: () => setDialog({ kind: 'role', member }) });
      items.push({
        label: 'Remove from workspace',
        danger: true,
        onSelect: () => setDialog({ kind: 'remove', member }),
      });
    }
    return items;
  }

  /** Member · Role · Linked employee · Last active · Status · overflow. */
  const columns: TableColumn<MemberSummary>[] = [
    {
      header: 'Member',
      width: 'minmax(200px, 1.5fr)',
      render: (member) => (
        <div className={styles.person}>
          <Avatar name={member.displayName} colorKey={member.id} size={26} />
          <div style={{ minWidth: 0 }}>
            <div className={styles.name}>{member.displayName}</div>
            <div className={styles.email}>{member.email}</div>
          </div>
        </div>
      ),
    },
    {
      header: 'Role',
      width: '110px',
      render: (member) => <Pill sv={ROLE_COLORS[member.role]}>{ROLE_LABELS[member.role]}</Pill>,
    },
    {
      header: 'Linked employee',
      width: '140px',
      render: (member) =>
        member.linkedEmployee ? (
          <Link to={`/employees/${member.linkedEmployee.id}`} className={styles.linkCell}>
            {member.linkedEmployee.displayName}
          </Link>
        ) : (
          // The design's em dash for an empty cell.
          <span className={styles.muted}>—</span>
        ),
    },
    {
      header: 'Last active',
      width: '110px',
      render: (member) => (
        <span className={styles.muted}>{formatRelativeTime(member.lastActiveAt)}</span>
      ),
    },
    {
      header: 'Status',
      width: '110px',
      render: (member) => (
        <Pill sv={MEMBER_STATUS_COLORS[member.status]}>{MEMBER_STATUS_LABELS[member.status]}</Pill>
      ),
    },
    {
      header: '',
      width: '40px',
      render: (member) =>
        manages ? (
          <Menu label={`Actions for ${member.displayName}`} items={rowActions(member)} />
        ) : null,
    },
  ];

  return (
    <PageContainer maxWidth={960}>
      <div className={styles.header}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Members</h1>
          <p className={styles.summary}>
            People who can sign in to this app. Company staff who hold assets live under{' '}
            <Link to="/employees">Employees</Link> — the same person can appear in both.
          </p>
        </div>
        {manages && (
          <Button icon="plus" onClick={() => openModal('inviteMember')}>
            Invite member
          </Button>
        )}
      </div>

      {members.isPending ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(member) => member.id}
          footer={`${rows.length} ${rows.length === 1 ? 'member' : 'members'} · roles: Admin (full access), Manager (edit), Viewer (read-only)`}
          empty={<EmptyState>Nobody can sign in yet — invite your first member.</EmptyState>}
        />
      )}

      {dialog?.kind === 'role' && (
        <ChangeRoleModal member={dialog.member} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveMemberModal member={dialog.member} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'link' && (
        <CopyLinkModal
          title={dialog.title}
          subtitle={dialog.subtitle}
          label={dialog.label}
          url={dialog.url}
          onClose={() => setDialog(null)}
        />
      )}
    </PageContainer>
  );
}
