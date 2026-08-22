import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  AUDIT_TYPES,
  LOG_RETENTION_LABELS,
  renderAuditEvent,
  type AuditType,
  type LogRetention,
} from '@inventory/shared';
import { useAuditLog, useSettings } from '@/api/queries';
import { DataTable, EmptyState, FilterPills, Pill, Spinner } from '@/components/ui';
import type { FilterPillOption } from '@/components/ui';
import { formatLogTime } from '@/lib/format';
import { setParam } from '@/lib/searchParams';
import type { AuditLogItem } from '@/types/api';
import type { TableColumn } from '@/types/table';
import styles from './Admin.module.css';

/** The API's own default page size; "Load more" adds another of these. */
const PAGE = 200;

/** Time · Actor · Event · Type, on the design's grid. */
const COLUMNS: TableColumn<AuditLogItem>[] = [
  {
    header: 'Time',
    width: '135px',
    render: (item) => <span className={styles.time}>{formatLogTime(item.at)}</span>,
  },
  {
    header: 'Actor',
    width: '150px',
    render: (item) => <span className={styles.actor}>{item.actorName}</span>,
  },
  {
    header: 'Event',
    width: '1fr',
    // One renderer for the trail, this log and the CSV export, so the three
    // can never describe the same event differently.
    render: (item) => <span className={styles.event}>{renderAuditEvent(item)}</span>,
  },
  {
    header: 'Type',
    width: '90px',
    render: (item) => (
      <Pill sv={AUDIT_TYPE_COLORS[item.type]} size="sm">
        {AUDIT_TYPE_LABELS[item.type]}
      </Pill>
    ),
  },
];

export function ActivityLogPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [limit, setLimit] = useState(PAGE);

  const type = readType(searchParams.get('type'));
  const log = useAuditLog({ type, limit });
  const settings = useSettings();

  const counts = log.data?.typeCounts;
  const options: FilterPillOption<AuditType | 'all'>[] = [
    { value: 'all', label: 'All', count: counts?.all },
    ...AUDIT_TYPES.map((value) => ({
      value,
      label: AUDIT_TYPE_LABELS[value],
      count: counts?.[value],
    })),
  ];

  // Events that have not arrived are no events to render.
  const items = log.data?.items ?? [];
  const total = log.data?.total ?? 0;

  return (
    <div className={styles.panel}>
      <div className={styles.logToolbar}>
        <FilterPills
          options={options}
          value={type ?? 'all'}
          onChange={(value) => {
            const params = new URLSearchParams(searchParams);
            setParam(params, 'type', value === 'all' ? '' : value);
            setSearchParams(params, { replace: true });
            setLimit(PAGE);
          }}
        />
        {/* A plain link, so the browser downloads the attachment itself and the
            session cookie goes with it — no blob, no second copy in memory. */}
        <a className={styles.export} href={`/api/v1/audit/export${type ? `?type=${type}` : ''}`}>
          Export log
        </a>
      </div>

      {log.isPending ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={items}
          rowKey={(item) => item.id}
          footer={`${total} ${total === 1 ? 'event' : 'events'} · retained for ${retention(settings.data?.settings.logRetentionMonths)}`}
          empty={<EmptyState>Nothing has happened under this filter yet.</EmptyState>}
        />
      )}

      {items.length < total && (
        <button type="button" className={styles.loadMore} onClick={() => setLimit(limit + PAGE)}>
          Load more
        </button>
      )}
    </div>
  );
}

/** An unknown ?type= is no filter, the same as none at all. */
function readType(value: string | null): AuditType | undefined {
  return AUDIT_TYPES.find((type) => type === value);
}

/**
 * The footer's retention note. `null` is "Forever" and `undefined` is settings
 * that have not loaded — the sentence stays honest about which it is.
 */
function retention(months: LogRetention | undefined): string {
  if (months === undefined) return 'the configured period';
  return LOG_RETENTION_LABELS[`${months}`];
}
