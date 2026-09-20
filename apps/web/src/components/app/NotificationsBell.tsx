import { useNavigate } from 'react-router';
import { useNotifications } from '@/api/queries';
import { IconButton } from '@/components/ui';
import styles from './NotificationsBell.module.css';

/**
 * The bell counts the unread — in its accessible name as well as on the badge —
 * and leads to the Notifications page, which is the inbox itself. Nothing is
 * marked read on the way there: reading is that page's own deliberate button.
 */
export function NotificationsBell() {
  const navigate = useNavigate();
  const inbox = useNotifications();

  // A payload that has not arrived yet has nothing to count.
  const unread = inbox.data?.unreadCount ?? 0;

  return (
    <span className={styles.wrap}>
      <IconButton
        icon="bell"
        bordered
        label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        onClick={() => navigate('/notifications')}
      />
      {unread > 0 && (
        // The button's label already says the count; this is the visual half.
        <span className={styles.badge} aria-hidden="true">
          {unread}
        </span>
      )}
    </span>
  );
}
