import { useState } from 'react';
import { renderNotification } from '@inventory/shared';
import { useMarkNotificationsRead } from '@/api/mutations';
import { INBOX_PAGE, useNotifications } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format';
import styles from './Notifications.module.css';

/**
 * The whole inbox, behind the topbar's bell: every notice the member ever got,
 * newest first, paged the way the activity log is. Reading is the "Mark all
 * read" button, deliberately — a page you merely glanced at has not been read,
 * and the unread marks should survive the glance.
 */
export function NotificationsPage() {
  const [limit, setLimit] = useState(INBOX_PAGE);
  const inbox = useNotifications(limit);
  const markRead = useMarkNotificationsRead();

  // A payload that has not arrived yet has no rows and nothing to count.
  const rows = inbox.data?.notifications ?? [];
  const unreadCount = inbox.data?.unreadCount ?? 0;
  const total = inbox.data?.total ?? 0;

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
        <Button
          variant="ghost"
          disabled={unreadCount === 0 || markRead.isPending}
          onClick={() => markRead.mutate()}
        >
          Mark all read
        </Button>
      </div>

      {inbox.isPending ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>You’re all caught up — nothing has happened since you last looked.</EmptyState>
      ) : (
        <>
          <ul className={styles.list}>
            {rows.map((row) => (
              <li key={row.id} className={styles.row} data-unread={row.readAt === null}>
                <span className={styles.sentence}>{renderNotification(row)}</span>
                <span className={styles.time}>{formatRelativeTime(row.createdAt)}</span>
              </li>
            ))}
          </ul>
          <div className={styles.count}>
            {total} {total === 1 ? 'notification' : 'notifications'} · kept for 90 days
          </div>
        </>
      )}

      {rows.length < total && (
        <button
          type="button"
          className={styles.loadMore}
          onClick={() => setLimit(limit + INBOX_PAGE)}
        >
          Load more
        </button>
      )}
    </PageContainer>
  );
}
