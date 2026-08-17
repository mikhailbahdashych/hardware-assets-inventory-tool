import { useLocation, useNavigate } from 'react-router';
import { PageContainer } from '@/components/app/PageContainer';
import { Tabs } from '@/components/ui';
import { ActivityLogPanel } from './ActivityLogPanel';
import { SettingsPanel } from './SettingsPanel';
import styles from './Admin.module.css';

const TABS = [
  { value: 'activity' as const, label: 'Activity log' },
  { value: 'settings' as const, label: 'Settings' },
];

type AdminTab = (typeof TABS)[number]['value'];

/**
 * Admins only — the route guard in routes.tsx is what enforces that, and the
 * API guards every endpoint underneath independently.
 */
export function AdminPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tab: AdminTab = pathname.endsWith('/settings') ? 'settings' : 'activity';

  return (
    <PageContainer maxWidth={1060} gap={16}>
      <div>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.summary}>Workspace activity and settings · visible to Admins only</p>
      </div>

      <Tabs
        tabs={TABS}
        value={tab}
        // The tab is the URL, so a filtered log stays shareable and the back
        // button moves between the two panels.
        onChange={(value) => navigate(`/admin/${value}`)}
      />

      {tab === 'activity' ? <ActivityLogPanel /> : <SettingsPanel />}
    </PageContainer>
  );
}
