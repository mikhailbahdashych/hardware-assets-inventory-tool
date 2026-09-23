import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AUDIT_ACTOR_KIND_LABELS,
  AUDIT_ACTOR_KINDS,
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  AUDIT_TYPES,
  LOG_RETENTION_LABELS,
  renderAuditEvent,
  type AuditActorKind,
  type AuditType,
  type LogRetention,
} from '@inventory/shared';
import { useAuditLog, useSettings } from '@/api/queries';
import {
  DataTable,
  Dropdown,
  EmptyState,
  FilterPills,
  Pagination,
  Pill,
  Spinner,
} from '@/components/ui';
import type { FilterPillOption } from '@/components/ui';
import { formatLogTime } from '@/lib/format';
import { setParam } from '@/lib/searchParams';
import { usePageSize } from '@/lib/usePageSize';
import type { AuditLogItem } from '@/types/api';
import type { TableColumn } from '@/types/table';
import styles from './Admin.module.css';

/** The API's own default page size, and the one the log starts at. */
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
    // A token's name is whatever an admin called it, so "Deploy bot" would
    // otherwise read as a colleague. The pill is what says it is a machine.
    render: (item) => (
      <span className={styles.actor}>
        {item.actorName}
        {item.actorKind === 'token' && (
          <Pill sv="info" size="sm">
            API
          </Pill>
        )}
      </span>
    ),
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
  const [page, setPage] = useState(1);
  // How many rows a page holds is the reader's choice, kept across visits.
  const [pageSize, setPageSize] = usePageSize('activity', PAGE);

  const type = readType(searchParams.get('type'));
  const actorKind = readActorKind(searchParams.get('actorKind'));
  const log = useAuditLog({ type, actorKind, limit: pageSize, offset: (page - 1) * pageSize });
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

  /** Both filters ride the URL, so a narrowed log is still a link. */
  function filter(key: 'type' | 'actorKind', value: string) {
    const params = new URLSearchParams(searchParams);
    setParam(params, key, value);
    setSearchParams(params, { replace: true });
    // A different filter is a different log; page three of it is not where
    // anybody meant to land.
    setPage(1);
  }

  // The file is what the screen is showing, so it carries both filters.
  const exportParams = new URLSearchParams();
  if (type) exportParams.set('type', type);
  if (actorKind) exportParams.set('actorKind', actorKind);
  const exportQuery = exportParams.toString();

  return (
    <div className={styles.panel}>
      <div className={styles.logToolbar}>
        <FilterPills
          options={options}
          value={type ?? 'all'}
          onChange={(value) => filter('type', value === 'all' ? '' : value)}
        />
        {/* Who, beside what: a token's line and a person's read alike until
            one of them is the only thing on screen. */}
        <div className={styles.actorFilter}>
          <Dropdown
            aria-label="Who acted"
            value={actorKind ?? ''}
            options={[
              { value: '', label: 'Anyone' },
              ...AUDIT_ACTOR_KINDS.map((kind) => ({
                value: kind,
                label: AUDIT_ACTOR_KIND_LABELS[kind],
              })),
            ]}
            onChange={(value) => filter('actorKind', value)}
          />
        </div>
        {/* A plain link, so the browser downloads the attachment itself and the
            session cookie goes with it — no blob, no second copy in memory. */}
        <a
          className={styles.export}
          href={`/api/v1/audit/export${exportQuery ? `?${exportQuery}` : ''}`}
        >
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

      <Pagination
        page={page}
        pageCount={Math.ceil(total / pageSize)}
        onChange={setPage}
        rowsPerPage={{
          size: pageSize,
          onChange: (size) => {
            setPageSize(size);
            // A smaller page is a different log; page three of it is not where
            // anybody meant to land.
            setPage(1);
          },
        }}
      />
    </div>
  );
}

/** An unknown ?type= is no filter, the same as none at all. */
function readType(value: string | null): AuditType | undefined {
  return AUDIT_TYPES.find((type) => type === value);
}

/** Same rule for ?actorKind=: a word the API would refuse narrows nothing. */
function readActorKind(value: string | null): AuditActorKind | undefined {
  return AUDIT_ACTOR_KINDS.find((kind) => kind === value);
}

/**
 * The footer's retention note. `null` is "Forever" and `undefined` is settings
 * that have not loaded — the sentence stays honest about which it is.
 */
function retention(months: LogRetention | undefined): string {
  if (months === undefined) return 'the configured period';
  return LOG_RETENTION_LABELS[`${months}`];
}
