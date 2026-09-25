import { Link, useLocation } from 'react-router';
import { useRoles } from '@/api/queries';
import { Avatar, Icon, IconButton } from '@/components/ui';
import { roleInfo, roleMap } from '@/lib/roles';
import { useModals } from '@/providers/ModalProvider';
import { isNavItemActive, navSectionsFor } from './nav';
import type { NavItem } from './types/nav';
import type { SidebarProps } from './types/sidebar';
import styles from './Sidebar.module.css';

export function Sidebar({ member, permissions, orgName, onSignOut }: SidebarProps) {
  const { pathname } = useLocation();
  // The same call the palette's action makes — one modal, two doors.
  const { openModal } = useModals();
  const sections = navSectionsFor(permissions, member.role);
  // The role under the member's name is a row's label, not a word this build
  // knows — the same lookup the Members page's pills go through.
  const roles = useRoles();

  function navLink(item: NavItem) {
    return (
      <Link
        key={item.to}
        to={item.to}
        className={styles.navItem}
        aria-current={isNavItemActive(item.to, pathname) ? 'page' : undefined}
      >
        <Icon name={item.icon} size={15} />
        {item.label}
      </Link>
    );
  }

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

      <nav className={styles.nav} aria-label="Inventory">
        {sections.inventory.map((item) => navLink(item))}
      </nav>

      {/* The workspace manages itself from the bottom, next to the person
          doing it; the inventory everybody came for keeps the top. */}
      <nav className={`${styles.nav} ${styles.navBottom}`} aria-label="Workspace">
        {sections.workspace.map((item) => navLink(item))}
      </nav>

      <div className={styles.footer}>
        <div className={styles.member}>
          <Avatar name={member.displayName} colorKey={member.id} size={24} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={styles.memberName}>{member.displayName}</div>
            {/* A full panel is wrong in a shell that has to stay usable, and a
                slug is worse: "Ada Okafor / admin" is a vocabulary this
                workspace never wrote. `roleInfo`'s fallback is for a role an
                admin has since deleted — historical data — not for a read that
                did not answer, so a read that did not answer says nothing.
                `isSuccess` is what makes the payload defined here. */}
            {roles.isSuccess && (
              <div className={styles.memberRole}>
                {roleInfo(roleMap(roles.data.roles), member.role).label}
              </div>
            )}
          </div>
          <IconButton
            icon="key"
            label="Change password"
            size={26}
            iconSize={13}
            onClick={() => openModal('changePassword')}
          />
          <IconButton icon="logOut" label="Sign out" size={26} iconSize={13} onClick={onSignOut} />
        </div>
      </div>
    </div>
  );
}
