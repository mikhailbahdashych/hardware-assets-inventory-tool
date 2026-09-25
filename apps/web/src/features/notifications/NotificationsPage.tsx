import { useState } from 'react';
import { renderNotification } from '@inventory/shared';
import { useMarkNotificationsRead } from '@/api/mutations';
import { INBOX_PAGE, useNotifications } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, Card, EmptyState, ErrorState, Pagination, Spinner } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format';
import { usePageSize } from '@/lib/usePageSize';
import styles from './Notifications.module.css';

/**
 * The whole inbox, behind the topbar's bell: every notice the member ever got,
 * newest first, in numbered pages like the activity log. Reading is the "Mark all
 * read" button, deliberately — a page you merely glanced at has not been read,
 * and the unread marks should survive the glance.
 */
export function NotificationsPage() {
  const [page, setPage] = useState(1);
  // How many rows a page holds is the reader's choice, kept across visits.
  const [pageSize, setPageSize] = usePageSize('notifications', INBOX_PAGE);
  const inbox = useNotifications(pageSize, (page - 1) * pageSize);
  const markRead = useMarkNotificationsRead();

  return (
    <PageContainer maxWidth={760}>
      <div className={styles.header}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Notifications</h1>
          <p className={styles.summary}>
            What the workspace wants you to know — hand-overs, returns coming due, warranties
            running out.
          </p>
        </div>
        {/* Nothing to mark while the inbox has not answered: zero unread is a
            fact about an inbox that did. */}
        <Button
          variant="ghost"
          disabled={!inbox.isSuccess || inbox.data.unreadCount === 0 || markRead.isPending}
          onClick={() => markRead.mutate()}
        >
          Mark all read
        </Button>
      </div>

      {/* Failed, then not yet here, then the notices — three states, three
          branches, and `data` is defined in the last one. */}
      {inbox.isError ? (
        <Card padding={false}>
          <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()}>
            Your notifications could not be loaded.
          </ErrorState>
        </Card>
      ) : !inbox.isSuccess ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : inbox.data.notifications.length === 0 ? (
        <EmptyState>You’re all caught up — nothing has happened since you last looked.</EmptyState>
      ) : (
        <>
          <ul className={styles.list}>
            {inbox.data.notifications.map((row) => (
              <li key={row.id} className={styles.row} data-unread={row.readAt === null}>
                <span className={styles.sentence}>{renderNotification(row)}</span>
                <span className={styles.time}>{formatRelativeTime(row.createdAt)}</span>
              </li>
            ))}
          </ul>
          <div className={styles.count}>
            {inbox.data.total} {inbox.data.total === 1 ? 'notification' : 'notifications'} · kept
            for 90 days
          </div>
        </>
      )}

      {/* A pager over a failure has nothing to page. */}
      {inbox.isSuccess && (
        <Pagination
          page={page}
          pageCount={Math.ceil(inbox.data.total / pageSize)}
          onChange={setPage}
          rowsPerPage={{
            size: pageSize,
            onChange: (size) => {
              setPageSize(size);
              // A smaller page is a different list; page three of it is not
              // where anybody meant to land.
              setPage(1);
            },
          }}
        />
      )}
    </PageContainer>
  );
}
