import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ASSET_CATEGORY_LABELS, can, type WorkflowStatus } from '@inventory/shared';
import { LIST_PAGE, useAssets, useWorkflow } from '@/api/queries';
import type { Asset } from '@/types/api';
import { ListToolbar } from '@/components/app/ListToolbar';
import { useModals } from '@/providers/ModalProvider';
import { PageContainer } from '@/components/app/PageContainer';
import {
  Button,
  DataTable,
  EmptyState,
  FilterPills,
  Pagination,
  Pill,
  SearchInput,
  Spinner,
} from '@/components/ui';
import type { TableColumn } from '@/types/table';
import { formatMonthYear } from '@/lib/format';
import { setParam } from '@/lib/searchParams';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { statusInfo, statusMap } from '@/lib/workflow';
import { assetStatusPills, parseStatusFilter } from './filters';
import type { AssetFilterUpdate, AssetsPageProps } from './types/assetsPage';
import styles from './Assets.module.css';

/**
 * The design's grid: Asset · Category · Serial · Status · Assigned to ·
 * Purchased · Warranty. Built per render rather than declared once, because
 * the Status cell needs the workspace's own labels and colours.
 */
const assetColumns = (statuses: WorkflowStatus[]): TableColumn<Asset>[] => {
  const byId = statusMap(statuses);
  return [
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
      // The design's em dash for an empty cell, here and below.
      render: (asset) => <span className={styles.serial}>{asset.serialNumber ?? '—'}</span>,
    },
    {
      header: 'Status',
      width: '110px',
      render: (asset) => {
        const { label, color } = statusInfo(byId, asset.status);
        return (
          <Pill sv={color} dot>
            {label}
          </Pill>
        );
      },
    },
    {
      header: 'Assigned to',
      width: '150px',
      render: (asset) => asset.currentHolder?.name ?? '—',
    },
    {
      header: 'Purchased',
      width: '95px',
      render: (asset) => (
        <span className={styles.small}>{formatMonthYear(asset.purchaseDate)}</span>
      ),
    },
    {
      header: 'Warranty',
      width: '95px',
      render: (asset) => (
        <span className={styles.small}>{formatMonthYear(asset.warrantyUntil)}</span>
      ),
    },
  ];
};

export function AssetsPage({ permissions }: AssetsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { openModal } = useModals();
  const workflow = useWorkflow();

  // A workflow that has not arrived has no statuses — the spinner below covers
  // that moment, so nothing is ever drawn without the labels it needs.
  const statuses = workflow.data?.statuses ?? [];

  // Filters live in the URL so a filtered view is shareable and survives a
  // reload — and so the dashboard can link straight to /assets?status=in_repair.
  const status = parseStatusFilter(searchParams.get('status'), statuses);
  // No `?q=` in the URL legitimately means "no filter".
  const query = searchParams.get('q') ?? '';
  // The input stays instant; the request waits for the typing to stop.
  const debounced = useDebouncedValue(query);

  // Either filter can be set on its own, so an absent key here means "leave
  // the other one as the URL already has it" — not "reset it".
  const setFilter = (next: AssetFilterUpdate) => {
    const params = new URLSearchParams(searchParams);
    setParam(params, 'status', next.status ?? parseStatusFilter(params.get('status'), statuses), {
      omitWhen: 'all',
    });
    setParam(params, 'q', next.q ?? params.get('q') ?? '');
    setSearchParams(params, { replace: true });
    // A different filter is a different list; page three of it is not where
    // anybody meant to land.
    setPage(1);
  };

  const assets = useAssets({
    // An empty search is no search: the parameter is left out of the key.
    q: debounced.trim() === '' ? undefined : debounced.trim(),
    status: status === 'all' ? undefined : status,
    limit: LIST_PAGE,
    offset: (page - 1) * LIST_PAGE,
  });

  // A payload that has not arrived has no rows and nothing to count.
  const rows = assets.data?.assets ?? [];
  const total = assets.data?.total ?? 0;
  const statusCounts = assets.data?.statusCounts ?? {};

  return (
    <PageContainer>
      <ListToolbar title="Assets" permissions={permissions}>
        {can(permissions, 'assets.create') && (
          <Button icon="plus" onClick={() => openModal('newAsset')}>
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
          options={assetStatusPills(statusCounts, statuses)}
          value={status}
          onChange={(next) => setFilter({ status: next })}
        />
      </div>

      {assets.isPending || workflow.isPending ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <DataTable
          columns={assetColumns(statuses)}
          rows={rows}
          rowKey={(asset) => asset.id}
          onRowClick={(asset) => navigate(`/assets/${asset.id}`)}
          footer={`${total} ${total === 1 ? 'asset' : 'assets'}`}
          empty={
            <EmptyState>
              {query === '' && status === 'all'
                ? 'No assets yet — add your first device to start tracking it.'
                : 'No assets match these filters.'}
            </EmptyState>
          }
        />
      )}

      <Pagination page={page} pageCount={Math.ceil(total / LIST_PAGE)} onChange={setPage} />
    </PageContainer>
  );
}
