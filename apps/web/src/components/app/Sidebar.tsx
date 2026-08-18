import { Link, useLocation } from 'react-router';
import { useRoles } from '@/api/queries';
import { Avatar, Icon, IconButton } from '@/components/ui';
import { roleInfo, roleMap } from '@/lib/roles';
import { isNavItemActive, navItemsForRole } from './nav';
import type { SidebarProps } from './types/sidebar';
import styles from './Sidebar.module.css';

export function Sidebar({ member, orgName, onSignOut }: SidebarProps) {
  const { pathname } = useLocation();
  const items = navItemsForRole(member.role);
  // The role under the member's name is a row's label, not a word this build
  // knows — the same lookup the Members page's pills go through.
  const roles = useRoles();
  const byId = roleMap(roles.data === undefined ? [] : roles.data.roles);

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
            <div className={styles.memberRole}>{roleInfo(byId, member.role).label}</div>
          </div>
          <IconButton icon="logOut" label="Sign out" size={26} iconSize={13} onClick={onSignOut} />
        </div>
      </div>
    </div>
  );
}
