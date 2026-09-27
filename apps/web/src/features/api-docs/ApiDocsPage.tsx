import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useApiDocs } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Card, ErrorState, Spinner } from '@/components/ui';
import { Reference } from './Reference';
import styles from './ApiDocs.module.css';

const INTERACTIVE_DOCS = '/api/public/docs';
const RAW_SPEC = '/api/public/openapi.json';

/**
 * The public API's reference, in this app's own type and colour. It renders
 * the OpenAPI document the instance serves — generated from the zod schemas
 * that validate those routes — rather than a copy of it, so it has the kitchen
 * sink's property: it cannot go stale, and a route added to the surface is on
 * this page with no change here.
 *
 * Read-only on purpose. Calls are tried in the interactive reference the API
 * serves beside the document; this page links there rather than growing a
 * second one. Admin-only like the tokens it documents — see `isAdmin`.
 */
export function ApiDocsPage() {
  const docs = useApiDocs();
  const { hash } = useLocation();

  // A shared link names one operation, but the cards arrive after the browser
  // looked for it, so the jump is made once they are here. A fragment naming
  // an operation the document no longer has simply stays at the top.
  useEffect(() => {
    if (!docs.isSuccess || hash === '') return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [docs.isSuccess, hash]);

  return (
    <PageContainer gap={16}>
      <div className={styles.intro}>
        <h1 className={styles.title}>API reference</h1>
        <p className={styles.summary}>
          Every endpoint another system can call on this workspace, read from the document this
          instance serves. Try a call in the <a href={INTERACTIVE_DOCS}>interactive reference</a>,
          or fetch the document itself as <a href={RAW_SPEC}>openapi.json</a>.
        </p>
      </div>

      {/* Failed, then not yet here, then the reference — three states, three
          branches, and `data` is defined in the last one. */}
      {docs.isError ? (
        <Card padding={false}>
          <ErrorState error={docs.error} onRetry={() => void docs.refetch()}>
            The API documentation could not be loaded.
          </ErrorState>
        </Card>
      ) : !docs.isSuccess ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <Reference spec={docs.data} />
      )}
    </PageContainer>
  );
}
