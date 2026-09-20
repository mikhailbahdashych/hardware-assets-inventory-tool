import { useLocation } from 'react-router';
import { useMeta } from '@/api/queries';
import { Icon, IconButton, Kbd } from '@/components/ui';
import { useBreadcrumbDetail } from '@/providers/BreadcrumbProvider';
import { useModals } from '@/providers/ModalProvider';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useThemeControls } from './useThemeControls';
import { breadcrumbForPath } from './nav';
import styles from './Topbar.module.css';

export function Topbar() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useThemeControls();
  const { openModal } = useModals();
  const detail = useBreadcrumbDetail();
  const meta = useMeta();
  const crumb = breadcrumbForPath(pathname, detail);
  // The tab mirrors the breadcrumb plus whose workspace this is — several
  // instances open at once is the normal self-hosted condition. Meta still
  // loading means the tab keeps its previous name for a beat, not a fallback.
  useDocumentTitle(crumb && meta.data ? `${crumb} · ${meta.data.orgName}` : undefined);

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
