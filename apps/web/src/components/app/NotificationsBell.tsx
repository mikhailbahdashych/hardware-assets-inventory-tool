import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderNotification } from '@inventory/shared';
import { useMarkNotificationsRead } from '@/api/mutations';
import { useNotifications } from '@/api/queries';
import { IconButton } from '@/components/ui';
import type { MenuAnchor } from '@/components/ui/types';
import { formatRelativeTime } from '@/lib/format';
import styles from './NotificationsBell.module.css';

const GAP = 4;

/**
 * The inbox: a bell counting the unread, and a portalled panel of sentences.
 * Opening the panel is what marks everything read — the rows are notices, not
 * tasks, so there is no per-row state to keep. The positioning and the three
 * ways of closing are `Menu`'s, for `Menu`'s reason: a panel rendered in place
 * is a panel the topbar clips.
 */
export function NotificationsBell() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const inbox = useNotifications();
  const markRead = useMarkNotificationsRead();

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    // Fixed position cannot follow a scroll, so it stops instead of drifting.
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [anchor]);

  // A payload that has not arrived yet has no rows and nothing to count.
  const rows = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unreadCount ?? 0;

  return (
    <>
      <span ref={trigger} className={styles.wrap}>
        <IconButton
          icon="bell"
          bordered
          label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
          aria-expanded={anchor !== null}
          onClick={(event) => {
            if (anchor) {
              setAnchor(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setAnchor({
              top: rect.bottom + GAP,
              right: window.innerWidth - rect.right,
              // Never taller than the room below it; the panel scrolls instead.
              maxHeight: window.innerHeight - rect.bottom - GAP * 3,
            });
            if (unread > 0) markRead.mutate();
          }}
        />
        {unread > 0 && (
          // The button's label already says the count; this is the visual half.
          <span className={styles.badge} aria-hidden="true">
            {unread}
          </span>
        )}
      </span>
      {anchor !== null &&
        createPortal(
          <div
            ref={panel}
            className={styles.panel}
            style={{ top: anchor.top, right: anchor.right, maxHeight: anchor.maxHeight }}
          >
            {rows.length === 0 ? (
              <div className={styles.empty}>You’re all caught up.</div>
            ) : (
              rows.map((row) => (
                <div key={row.id} className={styles.row}>
                  <div className={styles.sentence}>{renderNotification(row)}</div>
                  <div className={styles.time}>{formatRelativeTime(row.createdAt)}</div>
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
