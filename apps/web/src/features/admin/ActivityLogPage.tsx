import { PageContainer } from '@/components/app/PageContainer';
import { ActivityLogPanel } from './ActivityLogPanel';
import styles from './Admin.module.css';

/**
 * Its own page rather than a tab beside Settings: reading what happened and
 * changing how the workspace behaves are different jobs, done at different
 * times, and a tab made the log something you found by going somewhere else.
 *
 * Admins only — the route guard in routes.tsx enforces that, and `GET /audit`
 * guards itself independently.
 */
export function ActivityLogPage() {
  return (
    <PageContainer maxWidth={1060} gap={16}>
      <div>
        <h1 className={styles.title}>Activity log</h1>
        <p className={styles.summary}>
          Everything that has happened in this workspace · visible to Admins only
        </p>
      </div>
      <ActivityLogPanel />
    </PageContainer>
  );
}
