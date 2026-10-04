import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { API_SCOPE_LABELS } from '@inventory/shared';
import { useRevokeApiToken } from '@/api/mutations';
import { useApiTokens } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Menu,
  Pill,
  Spinner,
} from '@/components/ui';
import { formatFullDate, formatRelativeTime } from '@/lib/format';
import { survivor } from '@/lib/survivor';
import { useToast } from '@/providers/ToastProvider';
import type { ApiTokenSummary } from '@/types/api';
import type { TableColumn } from '@/types/table';
import { ApiTokenFormModal } from './ApiTokenFormModal';
import styles from './ApiTokens.module.css';

/**
 * The credentials that let another system talk to this one.
 *
 * Admin-only **by role** rather than by a grant — `isAdmin` in `lib/roles.ts`
 * says why, and `routes.tsx` is what enforces it, as the API does on every one
 * of these endpoints. There is no pager: a workspace runs a handful of
 * integrations, and the endpoint answers the whole list.
 */
export function ApiTokensPage() {
  const [creating, setCreating] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  // The row whose menu should take focus as it mounts: the one just disarmed,
  // or the neighbour of the one just revoked. Null until either happens.
  const [refocus, setRefocus] = useState<string | null>(null);
  // Null until the button mounts; it always has by the time a revoke lands.
  const newToken = useRef<HTMLButtonElement>(null);

  const toast = useToast();
  const tokens = useApiTokens();
  const revoke = useRevokeApiToken();

  const columns: TableColumn<ApiTokenSummary>[] = [
    {
      header: 'Token',
      width: 'minmax(160px, 1.2fr)',
      render: (token) => (
        <div style={{ minWidth: 0 }}>
          <div className={styles.name}>{token.name}</div>
          <div className={styles.meta}>Created by {token.createdByName}</div>
        </div>
      ),
    },
    {
      header: 'Scopes',
      width: 'minmax(220px, 1.6fr)',
      render: (token) => (
        <div className={styles.scopes}>
          {token.scopes.map((scope) => (
            <Pill key={scope} sv="neut" size="sm">
              {API_SCOPE_LABELS[scope]}
            </Pill>
          ))}
        </div>
      ),
    },
    {
      header: 'Created',
      width: '110px',
      render: (token) => <span className={styles.muted}>{formatFullDate(token.createdAt)}</span>,
    },
    {
      header: 'Expires',
      width: '110px',
      render: (token) => expiry(token.expiresAt),
    },
    {
      header: 'Last used',
      width: '95px',
      // The em dash is a token nobody has called with yet.
      render: (token) => (
        <span className={styles.muted}>{formatRelativeTime(token.lastUsedAt)}</span>
      ),
    },
    {
      header: '',
      // Wide enough for the second step's own button, which is what the first
      // step turns this cell into; right-aligned so the `···` still sits on
      // the table's edge the way it does on every other list.
      width: '130px',
      align: 'right',
      // Pinned: a scrolled table keeps the row's only door in view.
      sticky: 'end',
      render: (token) =>
        // Two steps, like deleting a custom field: the first opens the row's
        // own button, and the button is what does it. Every call using this
        // credential stops the moment it goes, and nothing recalls it.
        confirmingRevoke === token.id ? (
          <Button
            variant="danger"
            size="sm"
            // Armed means focused — a keyboard user is on it — and Escape or
            // leaving it disarms: a confirm left armed behind you is not one.
            autoFocus
            onBlur={() => setConfirmingRevoke(null)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              setConfirmingRevoke(null);
              setRefocus(token.id);
            }}
            disabled={revoke.isPending}
            onClick={() =>
              revoke.mutate(token.id, {
                onSuccess: () => {
                  toast.show(`Revoked "${token.name}".`, 'ok');
                  setConfirmingRevoke(null);
                  // The row is going; focus goes to its neighbour, or to the
                  // way to mint another when it was the last.
                  // The rows are drawn only from a list that arrived.
                  if (!tokens.isSuccess) throw new Error('A token was revoked from no list.');
                  const next = survivor(
                    tokens.data.map((row) => row.id),
                    token.id,
                  );
                  // Whichever it is, it is the only row that may take focus
                  // as it mounts — the revoked row's menu remounting for the
                  // moment before it leaves must not.
                  setRefocus(next);
                  if (next === null) newToken.current?.focus();
                },
                onError: (error) => toast.show(error.message, 'err'),
              })
            }
          >
            Revoke for good
          </Button>
        ) : (
          <Menu
            // A new key remounts the trigger, which is what lets autoFocus act.
            key={refocus === token.id ? 'refocus' : 'menu'}
            autoFocus={refocus === token.id}
            label={`Actions for ${token.name}`}
            items={[
              {
                label: 'Revoke',
                danger: true,
                onSelect: () => {
                  setConfirmingRevoke(token.id);
                  // A disarm by leaving the button must leave focus where it went.
                  setRefocus(null);
                },
              },
            ]}
          />
        ),
    },
  ];

  return (
    <PageContainer maxWidth={1060} gap={16}>
      <div className={styles.header}>
        <div className={styles.intro}>
          <h1 className={styles.title}>API tokens</h1>
          <p className={styles.summary}>
            Credentials for the systems that talk to this workspace without a person signing in.
            Each one reaches only what its scopes allow: the{' '}
            <Link to="/api-docs">API reference</Link> names the scope every endpoint needs, and
            calls can be tried in the <a href="/api/public/docs">interactive reference</a> this
            instance serves.
          </p>
        </div>
        <Button ref={newToken} icon="plus" onClick={() => setCreating(true)}>
          New token
        </Button>
      </div>

      {/* Failed, then not yet here, then the rows — three states, three
          branches, and `data` is defined in the last one. */}
      {tokens.isError ? (
        <Card padding={false}>
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()}>
            The API tokens could not be loaded.
          </ErrorState>
        </Card>
      ) : !tokens.isSuccess ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={tokens.data}
          rowKey={(token) => token.id}
          empty={
            <EmptyState>
              No API tokens yet. Mint one for the system that needs to read or change this inventory
              on its own.
            </EmptyState>
          }
        />
      )}

      {creating && <ApiTokenFormModal onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}

/**
 * The date, "Expired" once it is past, or the design's em dash for a token an
 * admin chose to leave unlimited. An expired token stays on the page until
 * somebody revokes it, so a call that stopped working is diagnosable here.
 */
function expiry(expiresAt: string | null) {
  if (expiresAt === null) return <span className={styles.muted}>—</span>;
  if (new Date(expiresAt).getTime() <= Date.now()) {
    return <Pill sv="err">Expired</Pill>;
  }
  return <span className={styles.muted}>{formatFullDate(expiresAt)}</span>;
}
