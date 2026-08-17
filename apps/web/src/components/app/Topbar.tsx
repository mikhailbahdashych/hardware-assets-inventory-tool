import { useLocation } from 'react-router';
import { Icon, IconButton, Kbd } from '@/components/ui';
import { useBreadcrumbDetail } from '@/providers/BreadcrumbProvider';
import { useModals } from '@/providers/ModalProvider';
import { useThemeControls } from './useThemeControls';
import { breadcrumbForPath } from './nav';
import styles from './Topbar.module.css';

export function Topbar() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useThemeControls();
  const { openModal } = useModals();
  const detail = useBreadcrumbDetail();

  return (
    <div className={styles.topbar}>
      <div className={styles.breadcrumb}>{breadcrumbForPath(pathname, detail)}</div>
      <div className={styles.actions}>
        {/* The same palette ⌘K opens: one search, two ways in. */}
        <button type="button" className={styles.search} onClick={() => openModal('palette')}>
          <Icon name="search" size={13} strokeWidth={1.8} />
          <span className={styles.searchLabel}>Search assets, people…</span>
          <Kbd>⌘K</Kbd>
        </button>
        <IconButton
          icon={theme === 'light' ? 'sun' : 'moon'}
          label="Toggle theme"
          bordered
          onClick={toggleTheme}
        />
      </div>
    </div>
  );
}
