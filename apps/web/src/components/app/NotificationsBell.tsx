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

  // A read that has not arrived — or failed — has nothing to count, and a bell
  // with no badge says exactly that: nothing to see here yet. A zero would be a
  // count somebody took, which is the one thing this does not have.
  const unread = inbox.isSuccess ? inbox.data.unreadCount : 0;

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
