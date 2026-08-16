import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ASSET_CATEGORY_LABELS,
  can,
  EMPLOYEE_STATUS_COLORS,
  EMPLOYEE_STATUS_LABELS,
  type Role,
} from '@inventory/shared';
import { useAssets, useEmployee } from '@/api/queries';
import type { Asset } from '@/api/types';
import { PageContainer } from '@/components/app/PageContainer';
import { usePageBreadcrumb } from '@/providers/BreadcrumbProvider';
import {
  Avatar,
  BackLink,
  Button,
  Card,
  DataTable,
  EmptyState,
  Pill,
  Spinner,
  type TableColumn,
} from '@/components/ui';
import { formatFullDate } from '@/lib/format';
import { EmployeeFormModal } from './EmployeeFormModal';
import styles from './Employees.module.css';

/** The design's holdings grid, minus the Check-in affordance (assignment PR). */
const HOLDING_COLUMNS: TableColumn<Asset>[] = [
  {
    header: 'Asset',
    width: 'minmax(210px, 1.6fr)',
    render: (asset) => (
      <>
        <div className={styles.holdingName}>{asset.name}</div>
        <div className={styles.holdingTag}>{asset.assetTag}</div>
      </>
    ),
  },
  {
    header: 'Category',
    width: '110px',
    render: (asset) => (
      <span className={styles.muted}>{ASSET_CATEGORY_LABELS[asset.category]}</span>
    ),
  },
  {
    header: 'Serial',
    width: '130px',
    render: (asset) => <span className={styles.holdingSerial}>{asset.serialNumber ?? '—'}</span>,
  },
  {
    header: 'Since',
    width: '130px',
    render: (asset) => (
      <span className={styles.muted}>
        {asset.currentHolder ? formatFullDate(asset.currentHolder.checkedOutAt) : '—'}
      </span>
    ),
  },
];

export function EmployeeDetailPage({ role }: { role: Role }) {
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const employee = useEmployee(id);
  const assets = useAssets();
  usePageBreadcrumb(employee.data?.displayName);

  if (employee.isPending) {
    return (
      <PageContainer variant="detail" maxWidth={1060}>
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      </PageContainer>
    );
  }

  if (employee.isError || !employee.data) {
    return (
      <PageContainer variant="detail" maxWidth={1060} gap={16}>
        <BackLink to="/employees">Employees</BackLink>
        <Card>
          <div className={styles.note}>That employee could not be found.</div>
        </Card>
      </PageContainer>
    );
  }

  const person = employee.data;
  // Holdings come from the asset list's current-holder field, so this page
  // needs no endpoint of its own until the ownership timeline lands.
  const holdings = (assets.data ?? []).filter(
    (asset) => asset.currentHolder?.employeeId === person.id,
  );
  const details = [person.jobTitle, person.department, person.location, person.email].filter(
    Boolean,
  );

  return (
    <PageContainer variant="detail" maxWidth={1060} gap={16}>
      <BackLink to="/employees">Employees</BackLink>

      <div className={styles.header}>
        <Avatar name={person.displayName} colorKey={person.id} size={44} />
        <div style={{ marginRight: 'auto', minWidth: 0 }}>
          <div className={styles.headline}>
            <h1 className={styles.title}>{person.displayName}</h1>
            <Pill sv={EMPLOYEE_STATUS_COLORS[person.status]}>
              {EMPLOYEE_STATUS_LABELS[person.status]}
            </Pill>
          </div>
          <div className={styles.meta}>{details.join(' · ')}</div>
        </div>
        {can(role, 'employees.edit') && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <DataTable
        title={`Currently holding · ${holdings.length}`}
        showHeader={false}
        columns={HOLDING_COLUMNS}
        rows={holdings}
        rowKey={(asset) => asset.id}
        onRowClick={(asset) => navigate(`/assets/${asset.id}`)}
        empty={<EmptyState>No assets currently assigned.</EmptyState>}
      />

      <Card title="Assignment history">
        <div className={styles.note}>
          Past holdings and their outcomes arrive with the assignment PR.
        </div>
      </Card>

      {editing && (
        <EmployeeFormModal
          employee={person}
          role={role}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate('/employees', { replace: true })}
        />
      )}
    </PageContainer>
  );
}
