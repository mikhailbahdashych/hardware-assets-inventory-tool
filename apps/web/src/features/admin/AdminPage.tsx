import { PageContainer } from '@/components/app/PageContainer';
import { SettingsPanel } from './SettingsPanel';
import styles from './Admin.module.css';

/**
 * Workspace settings. The activity log used to live here behind a tab and is
 * now its own page — see `ActivityLogPage`.
 *
 * Admins only, enforced by the route guard in routes.tsx; every endpoint
 * underneath guards itself as well.
 */
export function AdminPage() {
  return (
    <PageContainer maxWidth={1060} gap={16}>
      <div>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.summary}>Workspace settings · visible to Admins only</p>
      </div>
      <SettingsPanel />
    </PageContainer>
  );
}
