import { useLocation } from 'react-router';
import { Icon, IconButton, Kbd } from '@/components/ui';
import { useBreadcrumbDetail } from '@/providers/BreadcrumbProvider';
import { useToast } from '@/providers/ToastProvider';
import { useThemeControls } from './useThemeControls';
import { breadcrumbForPath } from './nav';
import styles from './Topbar.module.css';

export function Topbar() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useThemeControls();
  const { show } = useToast();
  const detail = useBreadcrumbDetail();

  return (
    <div className={styles.topbar}>
      <div className={styles.breadcrumb}>{breadcrumbForPath(pathname, detail ?? undefined)}</div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.search}
          onClick={() => show('Search arrives with the command palette.', 'info')}
        >
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
