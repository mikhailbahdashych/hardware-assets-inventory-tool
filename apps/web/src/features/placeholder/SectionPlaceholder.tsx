import { Card, PageHeader } from '../../components/ui';
import { PageContainer } from '../../components/app/PageContainer';

/**
 * Stands in for a section whose screens land in a later PR. It keeps the shell
 * navigable end-to-end and states plainly what is not built yet.
 */
export function SectionPlaceholder({
  title,
  maxWidth,
  summary,
}: {
  title: string;
  maxWidth?: number;
  summary: string;
}) {
  return (
    <PageContainer maxWidth={maxWidth}>
      <PageHeader title={title} />
      <Card>
        <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{summary}</div>
      </Card>
    </PageContainer>
  );
}
