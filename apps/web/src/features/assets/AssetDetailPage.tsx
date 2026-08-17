import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  can,
  renderAuditEvent,
} from '@inventory/shared';
import { orgMeta, useAsset, useMeta } from '@/api/queries';
import type { Asset, CustomFieldValue } from '@/types/api';
import { PageContainer } from '@/components/app/PageContainer';
import { usePageBreadcrumb } from '@/providers/BreadcrumbProvider';
import { Avatar, BackLink, Button, Card, KeyValueRow, Pill, Spinner } from '@/components/ui';
import { formatCurrency, formatDuration, formatFullDate } from '@/lib/format';
import { AssetFormModal } from './AssetFormModal';
import { AssignModal } from './AssignModal';
import { AttachmentsCard } from './AttachmentsCard';
import { ChangeStatusModal } from './ChangeStatusModal';
import { CheckInModal } from './CheckInModal';
import { ManageFieldsModal } from './ManageFieldsModal';
import { OwnershipTimeline } from './OwnershipTimeline';
import type { AssetDetailPageProps, OpenModal, PrimaryAction } from './types/assetDetailPage';
import styles from './Assets.module.css';

/** Booleans read as Yes/No; everything else shows as stored. */
function customValueText(field: CustomFieldValue): string {
  if (field.value === null) return '—';
  if (field.type === 'boolean') return field.value === 'true' ? 'Yes' : 'No';
  if (field.type === 'date') return formatFullDate(field.value);
  return field.value;
}

/**
 * The design's contextual primary action: an assigned asset is checked in, a
 * free one is assigned, anything else changes status. That third case is its
 * own modal rather than Assign — an asset in repair has no holder to change.
 */
function primaryAction(asset: Asset): PrimaryAction {
  if (asset.status === 'assigned') {
    return { label: 'Check in', modal: 'checkin', permission: 'assets.checkin' };
  }
  if (asset.status === 'available' || asset.status === 'ordered') {
    return { label: 'Assign', modal: 'assign', permission: 'assets.assign' };
  }
  return { label: 'Change status', modal: 'status', permission: 'assets.change_status' };
}

export function AssetDetailPage({ role }: AssetDetailPageProps) {
  const { id = '' } = useParams();
  const [open, setOpen] = useState<OpenModal>(null);
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

  const { asset, customFields, history, attachments, auditTrail } = detail.data;
  // An asset stores a currency only when it differs from the organization's,
  // so null here means "the org's" — that one is the rule, not a fallback.
  const currency = asset.currency ?? orgMeta(meta.data).defaultCurrency;
  const primary = primaryAction(asset);

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
          <Button variant="ghost" onClick={() => setOpen('edit')}>
            Edit
          </Button>
        )}
        {can(role, primary.permission) && (
          <Button onClick={() => setOpen(primary.modal)}>{primary.label}</Button>
        )}
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <Card title="Details">
            <div className={styles.pairs}>
              <KeyValueRow k="Category">{ASSET_CATEGORY_LABELS[asset.category]}</KeyValueRow>
              {/* The design's em dash for an unrecorded value, here and below. */}
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
            <Card
              title={
                <span className={styles.cardHeader}>
                  Custom fields
                  {can(role, 'custom_fields.manage') && (
                    <button
                      type="button"
                      className={styles.cardLink}
                      onClick={() => setOpen('fields')}
                    >
                      Manage fields
                    </button>
                  )}
                </span>
              }
            >
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

          <AttachmentsCard assetId={asset.id} attachments={attachments} role={role} />

          <Card title="Audit log">
            {auditTrail.length === 0 ? (
              <div className={styles.note}>Nothing recorded yet.</div>
            ) : (
              <div className={styles.trail}>
                {auditTrail.map((entry) => (
                  <div key={entry.id} className={styles.trailRow}>
                    <span className={styles.trailDate}>{entry.at.slice(0, 10)}</span>
                    <span className={styles.trailText}>
                      {renderAuditEvent(entry)}
                      <span className={styles.trailActor}> · {entry.actorName}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
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
                  {asset.currentHolder.expectedReturnDate && (
                    <> · due back {formatFullDate(asset.currentHolder.expectedReturnDate)}</>
                  )}
                </div>
              </>
            ) : (
              <div className={styles.note}>
                Nobody is holding this asset — it is {ASSET_STATUS_LABELS[asset.status]}.
              </div>
            )}
          </Card>

          <Card title="Ownership history">
            <OwnershipTimeline history={history} assetCreatedAt={asset.createdAt} />
          </Card>
        </div>
      </div>

      {open === 'edit' && (
        <AssetFormModal
          asset={asset}
          customFields={customFields}
          role={role}
          onClose={() => setOpen(null)}
          onDeleted={() => navigate('/assets', { replace: true })}
        />
      )}
      {open === 'assign' && (
        <AssignModal
          mode="pick-employee"
          assetId={asset.id}
          assetName={asset.assetTag}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'checkin' && <CheckInModal asset={asset} onClose={() => setOpen(null)} />}
      {open === 'status' && <ChangeStatusModal asset={asset} onClose={() => setOpen(null)} />}
      {open === 'fields' && <ManageFieldsModal onClose={() => setOpen(null)} />}
    </PageContainer>
  );
}
