import { Link, useNavigate } from 'react-router';
import { ASSET_CATEGORY_LABELS, AUDIT_TYPE_COLORS, renderAuditEvent } from '@inventory/shared';
import { useDashboard } from '@/api/queries';
import { PageContainer } from '@/components/app/PageContainer';
import { Button, EmptyState, Pill, Spinner } from '@/components/ui';
import { formatFullDate, formatRelativeTime } from '@/lib/format';
import { useModals } from '@/providers/ModalProvider';
import { isWidgetVisible, warrantyUrgency, type WidgetKey } from './widgets';
import type {
  CategoryBarsProps,
  DashboardPageProps,
  PendingReturnsProps,
  RecentActivityProps,
  StatusCountsProps,
  WarrantyExpirationsProps,
} from './types/dashboardPage';
import styles from './Dashboard.module.css';

export function DashboardPage({ member }: DashboardPageProps) {
  const dashboard = useDashboard();
  const { openModal } = useModals();

  const shows = (key: WidgetKey) => isWidgetVisible(member.widgets, key);

  return (
    <PageContainer gap={20}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.summary}>
            {today()} · {dashboard.data?.assetCount ?? 0} assets tracked
          </p>
        </div>
        <Button variant="ghost" icon="pencil" onClick={() => openModal('widgets')}>
          Customize widgets
        </Button>
      </div>

      {dashboard.isPending || !dashboard.data ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <>
          {shows('kpi') && <StatusCounts data={dashboard.data} />}
          <div className={styles.columns}>
            <div className={styles.column}>
              {shows('category') && <CategoryBars data={dashboard.data} />}
              {shows('activity') && <RecentActivity data={dashboard.data} />}
            </div>
            <div className={styles.column}>
              {shows('warranty') && <WarrantyExpirations data={dashboard.data} />}
              {shows('returns') && <PendingReturns data={dashboard.data} />}
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}

/** "Saturday, Aug 16" — the design's subtitle, in the reader's own timezone. */
function today(): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());
}

/**
 * A tile per status the workspace has, in its order, each a link into the
 * assets list already filtered to it. The payload carries the label and the
 * colour, so a status an admin added yesterday gets a tile with no code
 * change — and the grid wraps rather than squeezing a seventh into six.
 */
function StatusCounts({ data }: StatusCountsProps) {
  const navigate = useNavigate();
  return (
    <div className={styles.kpis}>
      {data.statusCounts.map((status) => (
        <button
          key={status.id}
          type="button"
          className={styles.kpi}
          // What separates the label from the count on screen is layout, and an
          // accessible name cannot see layout — without this the two run
          // together as "Available4".
          aria-label={`${status.label} ${status.count}`}
          onClick={() => navigate(`/assets?status=${encodeURIComponent(status.id)}`)}
        >
          <span className={styles.kpiLabel}>
            <span className={styles.kpiDot} data-sv={status.color} />
            {status.label}
          </span>
          <span className={styles.kpiCount}>{status.count}</span>
        </button>
      ))}
    </div>
  );
}

function CategoryBars({ data }: CategoryBarsProps) {
  const largest = Math.max(1, ...data.categoryCounts.map((entry) => entry.count));
  // Biggest first, as the design draws it — a bar chart is a ranking. The API
  // sends every category in enum order, so equal counts keep a stable order
  // and an empty category sinks to the bottom rather than disappearing.
  const ranked = [...data.categoryCounts].sort((a, b) => b.count - a.count);

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Assets by category</h2>
      <div className={styles.bars}>
        {ranked.map((entry) => (
          <div key={entry.category} className={styles.bar}>
            <span className={styles.barLabel}>{ASSET_CATEGORY_LABELS[entry.category]}</span>
            <div
              className={styles.track}
              role="meter"
              aria-label={ASSET_CATEGORY_LABELS[entry.category]}
              aria-valuenow={entry.count}
              aria-valuemin={0}
              aria-valuemax={largest}
            >
              {/* Proportional to the biggest bar, so the shape reads even when
                  the whole fleet is a dozen devices. */}
              <div className={styles.fill} style={{ width: `${(entry.count / largest) * 100}%` }} />
            </div>
            <span className={styles.barCount}>{entry.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentActivity({ data }: RecentActivityProps) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Recent activity</h2>
        <Link to="/activity" className={styles.cardLink}>
          Audit log
        </Link>
      </div>
      <div className={styles.rows}>
        {data.recentActivity.map((event) => (
          <div key={event.id} className={styles.activityRow}>
            <span className={styles.activityDot} data-sv={AUDIT_TYPE_COLORS[event.type]} />
            {/* One renderer for the trail, the log, the export and this. */}
            <span className={styles.activityText}>
              {renderAuditEvent(event)}
              <span className={styles.activityActor}> — {event.actorName}</span>
            </span>
            <span className={styles.activityWhen}>{formatRelativeTime(event.at)}</span>
          </div>
        ))}
        {data.recentActivity.length === 0 && <EmptyState>Nothing has happened yet.</EmptyState>}
      </div>
    </section>
  );
}

function WarrantyExpirations({ data }: WarrantyExpirationsProps) {
  const navigate = useNavigate();
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitleTight}>Warranty expirations</h2>
      <div className={styles.rows}>
        {data.warrantyExpirations.map((entry) => (
          <button
            key={entry.assetId}
            type="button"
            className={styles.listRow}
            onClick={() => navigate(`/assets/${entry.assetId}`)}
          >
            <span className={styles.listText}>
              <span className={styles.listTitle}>{entry.name}</span>
              <span className={styles.listTag}>{entry.assetTag}</span>
            </span>
            <Pill sv={warrantyUrgency(entry.daysLeft)} strong>
              {entry.daysLeft} {entry.daysLeft === 1 ? 'day' : 'days'}
            </Pill>
          </button>
        ))}
        {data.warrantyExpirations.length === 0 && (
          <p className={styles.blank}>No warranties expire in the next 90 days.</p>
        )}
      </div>
    </section>
  );
}

function PendingReturns({ data }: PendingReturnsProps) {
  const navigate = useNavigate();
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitleTight}>Pending returns</h2>
      <div className={styles.rows}>
        {data.pendingReturns.map((entry) => (
          <button
            key={entry.assetId}
            type="button"
            className={styles.listRow}
            onClick={() => navigate(`/assets/${entry.assetId}`)}
          >
            <span className={styles.listText}>
              <span className={styles.listTitle}>{entry.assetName}</span>
              <span className={styles.listSub}>{entry.holderName}</span>
            </span>
            <span className={styles.listDue}>due {formatFullDate(entry.expectedReturnDate)}</span>
          </button>
        ))}
        {data.pendingReturns.length === 0 && (
          <p className={styles.blank}>Nothing is due back right now.</p>
        )}
      </div>
      <p className={styles.footnote}>
        Triggered by offboarding · holders are reminded by email when SMTP is configured
      </p>
    </section>
  );
}
