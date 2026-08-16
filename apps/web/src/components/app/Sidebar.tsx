import { Link, useLocation } from 'react-router';
import { ROLE_LABELS } from '@inventory/shared';
import type { Member } from '@/api/types';
import { Avatar, Icon, IconButton } from '@/components/ui';
import { isNavItemActive, navItemsForRole } from './nav';
import styles from './Sidebar.module.css';

export function Sidebar({
  member,
  orgName,
  onSignOut,
}: {
  member: Member;
  orgName: string;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const items = navItemsForRole(member.role);

  return (
    <div className={styles.sidebar}>
      <div className={styles.wordmark}>
        <span className={styles.logo}>
          <Icon name="cube" size={13} strokeWidth={1.9} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className={styles.orgName}>{orgName}</div>
          <div className={styles.productName}>Inventory</div>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Sections">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={styles.navItem}
            data-gap-before={item.gapBefore}
            aria-current={isNavItemActive(item.to, pathname) ? 'page' : undefined}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className={styles.footer}>
        <div className={styles.member}>
          <Avatar name={member.displayName} colorKey={member.id} size={24} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={styles.memberName}>{member.displayName}</div>
            <div className={styles.memberRole}>{ROLE_LABELS[member.role]}</div>
          </div>
          <IconButton icon="logOut" label="Sign out" size={26} iconSize={13} onClick={onSignOut} />
        </div>
      </div>
    </div>
  );
}
