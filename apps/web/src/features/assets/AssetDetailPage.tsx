import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  can,
  type Role,
} from '@inventory/shared';
import { useAsset, useMeta } from '@/api/queries';
import type { CustomFieldValue } from '@/api/types';
import { PageContainer } from '@/components/app/PageContainer';
import { usePageBreadcrumb } from '@/providers/BreadcrumbProvider';
import { Avatar, BackLink, Button, Card, KeyValueRow, Pill, Spinner } from '@/components/ui';
import { formatCurrency, formatDuration, formatFullDate } from '@/lib/format';
import { AssetFormModal } from './AssetFormModal';
import styles from './Assets.module.css';

/** Booleans read as Yes/No; everything else shows as stored. */
function customValueText(field: CustomFieldValue): string {
  if (field.value === null) return '—';
  if (field.type === 'boolean') return field.value === 'true' ? 'Yes' : 'No';
  if (field.type === 'date') return formatFullDate(field.value);
  return field.value;
}

export function AssetDetailPage({ role }: { role: Role }) {
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const detail = useAsset(id);
  const meta = useMeta();
  usePageBreadcrumb(detail.data?.asset.assetTag);

  if (detail.isPending) {
    return (
      <PageContainer variant="detail" maxWidth={1060}>
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      </PageContainer>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <PageContainer variant="detail" maxWidth={1060} gap={16}>
        <BackLink to="/assets">Assets</BackLink>
        <Card>
          <div className={styles.note}>That asset could not be found.</div>
        </Card>
      </PageContainer>
    );
  }

  const { asset, customFields } = detail.data;
  const currency = asset.currency ?? meta.data?.defaultCurrency ?? 'EUR';

  return (
    <PageContainer variant="detail" maxWidth={1060} gap={16}>
      <BackLink to="/assets">Assets</BackLink>

      <div className={styles.header}>
        <div style={{ minWidth: 0, marginRight: 'auto' }}>
          <div className={styles.headline}>
            <h1 className={styles.title}>{asset.name}</h1>
            <Pill sv={ASSET_STATUS_COLORS[asset.status]} dot>
              {ASSET_STATUS_LABELS[asset.status]}
            </Pill>
          </div>
          <div className={styles.identifiers}>
            {asset.assetTag}
            {asset.serialNumber ? ` · ${asset.serialNumber}` : ''}
          </div>
        </div>
        {can(role, 'assets.edit') && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <Card title="Details">
            <div className={styles.pairs}>
              <KeyValueRow k="Category">{ASSET_CATEGORY_LABELS[asset.category]}</KeyValueRow>
              <KeyValueRow k="Model">{asset.model ?? '—'}</KeyValueRow>
              <KeyValueRow k="Serial">{asset.serialNumber ?? '—'}</KeyValueRow>
              <KeyValueRow k="Asset tag">{asset.assetTag}</KeyValueRow>
              <KeyValueRow k="Purchased">{formatFullDate(asset.purchaseDate)}</KeyValueRow>
              <KeyValueRow k="Price">
                {formatCurrency(asset.purchasePriceCents, currency)}
              </KeyValueRow>
              <KeyValueRow k="Warranty">{formatFullDate(asset.warrantyUntil)}</KeyValueRow>
              <KeyValueRow k="Supplier">{asset.supplier ?? '—'}</KeyValueRow>
            </div>
          </Card>

          {customFields.length > 0 && (
            <Card title="Custom fields">
              <div className={styles.pairs}>
                {customFields.map((field) => (
                  <KeyValueRow key={field.key} k={field.label}>
                    {customValueText(field)}
                  </KeyValueRow>
                ))}
              </div>
            </Card>
          )}

          {asset.notes && (
            <Card title="Notes">
              <div className={styles.note}>{asset.notes}</div>
            </Card>
          )}
        </div>

        <div className={styles.column}>
          <Card title="Current holder">
            {asset.currentHolder ? (
              <>
                {asset.currentHolder.employeeId ? (
                  <Link
                    to={`/employees/${asset.currentHolder.employeeId}`}
                    className={styles.holder}
                  >
                    <Avatar
                      name={asset.currentHolder.name}
                      colorKey={asset.currentHolder.employeeId}
                      size={30}
                    />
                    <div>
                      <div className={styles.holderName}>{asset.currentHolder.name}</div>
                      <div className={styles.holderSub}>View employee</div>
                    </div>
                  </Link>
                ) : (
                  <div className={styles.holder}>
                    <Avatar name={asset.currentHolder.name} size={30} />
                    <div>
                      <div className={styles.holderName}>{asset.currentHolder.name}</div>
                      <div className={styles.holderSub}>No longer an employee</div>
                    </div>
                  </div>
                )}
                <div className={styles.holderMeta}>
                  Checked out {formatFullDate(asset.currentHolder.checkedOutAt)} ·{' '}
                  {formatDuration(asset.currentHolder.checkedOutAt)}
                </div>
              </>
            ) : (
              <div className={styles.note}>
                Nobody is holding this asset — it is {ASSET_STATUS_LABELS[asset.status]}.
              </div>
            )}
          </Card>

          <Card title="Ownership history">
            <div className={styles.note}>
              The full timeline, attachments and this asset&apos;s audit trail arrive with the
              assignment PR.
            </div>
          </Card>
        </div>
      </div>

      {editing && (
        <AssetFormModal
          asset={asset}
          customFields={customFields}
          role={role}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate('/assets', { replace: true })}
        />
      )}
    </PageContainer>
  );
}
