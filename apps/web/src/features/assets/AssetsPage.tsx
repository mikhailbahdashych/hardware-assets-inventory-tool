import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  can,
  type Role,
} from '@inventory/shared';
import { useAssets } from '@/api/queries';
import type { Asset } from '@/api/types';
import { ListToolbar } from '@/components/app/ListToolbar';
import { PageContainer } from '@/components/app/PageContainer';
import {
  Button,
  DataTable,
  EmptyState,
  FilterPills,
  Pill,
  SearchInput,
  Spinner,
  type TableColumn,
} from '@/components/ui';
import { formatMonthYear } from '@/lib/format';
import { setParam } from '@/lib/searchParams';
import { AssetFormModal } from './AssetFormModal';
import { assetStatusPills, filterAssets, parseStatusFilter, type StatusFilter } from './filters';
import styles from './Assets.module.css';

/** The design's grid: Asset · Category · Serial · Status · Assigned to · Purchased · Warranty. */
const COLUMNS: TableColumn<Asset>[] = [
  {
    header: 'Asset',
    width: 'minmax(210px, 1.6fr)',
    render: (asset) => (
      <>
        <div className={styles.name}>{asset.name}</div>
        <div className={styles.tag}>{asset.assetTag}</div>
      </>
    ),
  },
  {
    header: 'Category',
    width: '100px',
    render: (asset) => (
      <span className={styles.muted}>{ASSET_CATEGORY_LABELS[asset.category]}</span>
    ),
  },
  {
    header: 'Serial',
    width: '130px',
    render: (asset) => <span className={styles.serial}>{asset.serialNumber ?? '—'}</span>,
  },
  {
    header: 'Status',
    width: '110px',
    render: (asset) => (
      <Pill sv={ASSET_STATUS_COLORS[asset.status]} dot>
        {ASSET_STATUS_LABELS[asset.status]}
      </Pill>
    ),
  },
  {
    header: 'Assigned to',
    width: '150px',
    render: (asset) => asset.currentHolder?.name ?? '—',
  },
  {
    header: 'Purchased',
    width: '95px',
    render: (asset) => <span className={styles.small}>{formatMonthYear(asset.purchaseDate)}</span>,
  },
  {
    header: 'Warranty',
    width: '95px',
    render: (asset) => <span className={styles.small}>{formatMonthYear(asset.warrantyUntil)}</span>,
  },
];

export function AssetsPage({ role }: { role: Role }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const assets = useAssets();

  // Filters live in the URL so a filtered view is shareable and survives a
  // reload — and so the dashboard can link straight to /assets?status=in_repair.
  const status = parseStatusFilter(searchParams.get('status'));
  const query = searchParams.get('q') ?? '';
  const setFilter = (next: { status?: StatusFilter; q?: string }) => {
    const params = new URLSearchParams(searchParams);
    setParam(params, 'status', next.status ?? parseStatusFilter(params.get('status')), {
      omitWhen: 'all',
    });
    setParam(params, 'q', next.q ?? params.get('q') ?? '');
    setSearchParams(params, { replace: true });
  };

  const all = assets.data ?? [];
  const rows = filterAssets(all, { status, query });

  return (
    <PageContainer>
      <ListToolbar title="Assets">
        {can(role, 'assets.create') && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            New asset
          </Button>
        )}
      </ListToolbar>

      <div className={styles.filters}>
        <SearchInput
          value={query}
          onChange={(event) => setFilter({ q: event.target.value })}
          placeholder="Filter by name, tag or serial…"
          aria-label="Filter assets"
        />
        <FilterPills
          options={assetStatusPills(all)}
          value={status}
          onChange={(next) => setFilter({ status: next })}
        />
      </div>

      {assets.isPending ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(asset) => asset.id}
          onRowClick={(asset) => navigate(`/assets/${asset.id}`)}
          footer={`${rows.length} ${rows.length === 1 ? 'asset' : 'assets'}`}
          empty={
            <EmptyState>
              {all.length === 0
                ? 'No assets yet — add your first device to start tracking it.'
                : 'No assets match these filters.'}
            </EmptyState>
          }
        />
      )}

      {creating && <AssetFormModal role={role} onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}
