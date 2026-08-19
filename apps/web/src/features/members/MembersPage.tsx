import { useState } from 'react';
import { Link } from 'react-router';
import {
  can,
  MEMBER_STATUS_COLORS,
  MEMBER_STATUS_LABELS,
  RECOVERY_CODE_COUNT,
} from '@inventory/shared';
import {
  useIssueResetLink,
  useResendInvite,
  useResetMemberMfa,
  useResetRecoveryCodes,
} from '@/api/mutations';
import { useMembers, useRoles } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Avatar, Button, DataTable, EmptyState, Menu, Pill, Spinner } from '@/components/ui';
import type { MenuItem } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format';
import { roleInfo, roleMap } from '@/lib/roles';
import { useModals } from '@/providers/ModalProvider';
import { useToast } from '@/providers/ToastProvider';
import type { MemberSummary } from '@/types/api';
import type { TableColumn } from '@/types/table';
import { ChangeRoleModal } from './ChangeRoleModal';
import { CopyLinkModal } from './CopyLinkModal';
import { RemoveMemberModal } from './RemoveMemberModal';
import type { MembersDialog, MembersPageProps } from './types/membersPage';
import styles from './Members.module.css';

export function MembersPage({ permissions, memberId }: MembersPageProps) {
  const [dialog, setDialog] = useState<MembersDialog | null>(null);
  const toast = useToast();
  const { openModal } = useModals();
  const members = useMembers();
  // A role pill has words and a colour only because a row says so.
  const roles = useRoles();
  const resend = useResendInvite();
  const reset = useIssueResetLink();
  const resetMfa = useResetMemberMfa();
  const resetCodes = useResetRecoveryCodes();
  const manages = can(permissions, 'members.manage');

  // A list that has not arrived has no rows; the empty state renders below.
  const rows = members.data ?? [];
  const roleRows = roles.data === undefined ? [] : roles.data.roles;
  const byRoleId = roleMap(roleRows);

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

    // Unlike role and removal, this *is* allowed on your own account: locking
    // yourself out of an authenticator is not a way to leave the workspace
    // without an admin, and the alternative is telling the only admin to phone
    // themselves.
    if (member.mfaEnrolled) {
      items.push({
        label: 'Reset two-factor',
        onSelect: () =>
          resetMfa.mutate(
            { id: member.id },
            {
              onSuccess: () =>
                toast.show(`${member.displayName} will set up an authenticator again.`, 'ok'),
              onError: (error) => toast.show(error.message, 'err'),
            },
          ),
      });
      // The gentler half: the authenticator stays, the codes go. There is no
      // link or list to show afterwards — a new set can only be handed over by
      // the sign-in that needs it, which is where the member will meet it.
      items.push({
        label: 'Reset recovery codes',
        onSelect: () =>
          resetCodes.mutate(
            { id: member.id },
            {
              onSuccess: () =>
                toast.show(
                  `${member.displayName} will get fresh codes at their next sign-in.`,
                  'ok',
                ),
              onError: (error) => toast.show(error.message, 'err'),
            },
          ),
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

  /**
   * Member · Role · Linked employee · Last active · Status · [Two-factor] ·
   * overflow. The bracketed one is drawn only for a viewer who can act on it:
   * the payload is the same for everybody, because reads are open, and the
   * gate is the affordance — as it is for every other admin control here.
   *
   * The other widths shrank to make room for it, because they have to: this
   * page is 960 wide by the design's own note, the table clips its overflow
   * (that clip is what gives the cells their ellipsis), and a seventh column
   * that did not fit would take the `···` button off the right-hand edge.
   */
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
      width: '100px',
      render: (member) => {
        const role = roleInfo(byRoleId, member.role);
        return <Pill sv={role.color}>{role.label}</Pill>;
      },
    },
    {
      header: 'Linked employee',
      width: '120px',
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
      width: '95px',
      render: (member) => (
        <span className={styles.muted}>{formatRelativeTime(member.lastActiveAt)}</span>
      ),
    },
    {
      header: 'Status',
      width: '100px',
      render: (member) => (
        <Pill sv={MEMBER_STATUS_COLORS[member.status]}>{MEMBER_STATUS_LABELS[member.status]}</Pill>
      ),
    },
    ...(manages
      ? [
          {
            header: 'Two-factor',
            width: '130px',
            render: (member: MemberSummary) =>
              // A null count and "not enrolled" are the same fact from two
              // sides: no authenticator, so no set of codes to count. The
              // design's em dash says it.
              member.recoveryCodesLeft === null ? (
                <span className={styles.muted}>—</span>
              ) : (
                <div className={styles.twoFactor}>
                  <Pill sv="ok">Enrolled</Pill>
                  <span className={styles.codesLeft}>
                    {member.recoveryCodesLeft} of {RECOVERY_CODE_COUNT} codes left
                  </span>
                </div>
              ),
          },
        ]
      : []),
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
          // The roles are the workspace's own, so the footer names the ones it
          // has rather than the three this build used to ship with.
          footer={`${rows.length} ${rows.length === 1 ? 'member' : 'members'} · roles: ${roleRows.map((role) => role.label).join(', ')}`}
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
