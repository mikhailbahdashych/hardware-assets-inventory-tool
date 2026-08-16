import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ASSET_CATEGORY_LABELS,
  ASSIGNMENT_OUTCOME_LABELS,
  can,
  EMPLOYEE_STATUS_COLORS,
  EMPLOYEE_STATUS_LABELS,
  type Role,
} from '@inventory/shared';
import { useEmployee } from '@/api/queries';
import type { Holding } from '@/types/api';
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
} from '@/components/ui';
import type { TableColumn } from '@/types/table';
import { formatFullDate, formatMonthYear } from '@/lib/format';
import { AssignModal } from '../assets/AssignModal';
import { CheckInModal } from '../assets/CheckInModal';
import { EmployeeFormModal } from './EmployeeFormModal';
import styles from './Employees.module.css';

/** A past holding reads as a date range plus why it ended. */
function historyRange(holding: Holding): string {
  const range = `${formatMonthYear(holding.checkedOutAt)} → ${formatMonthYear(holding.returnedAt)}`;
  return holding.outcome ? `${range} · ${ASSIGNMENT_OUTCOME_LABELS[holding.outcome]}` : range;
}

export function EmployeeDetailPage({ role }: { role: Role }) {
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [checkingIn, setCheckingIn] = useState<Holding | null>(null);
  const navigate = useNavigate();
  const detail = useEmployee(id);
  usePageBreadcrumb(detail.data?.employee.displayName);

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
        <BackLink to="/employees">Employees</BackLink>
        <Card>
          <div className={styles.note}>That employee could not be found.</div>
        </Card>
      </PageContainer>
    );
  }

  const { employee, holdings, history } = detail.data;
  const details = [
    employee.jobTitle,
    employee.department,
    employee.location,
    employee.email,
  ].filter(Boolean);

  // The design's holdings grid, with the check-in affordance on each row.
  const columns: TableColumn<Holding>[] = [
    {
      header: 'Asset',
      width: 'minmax(210px, 1.6fr)',
      render: (holding) => (
        <>
          <div className={styles.holdingName}>{holding.assetName}</div>
          <div className={styles.holdingTag}>{holding.assetTag}</div>
        </>
      ),
    },
    {
      header: 'Category',
      width: '110px',
      render: (holding) => (
        <span className={styles.muted}>{ASSET_CATEGORY_LABELS[holding.category]}</span>
      ),
    },
    {
      header: 'Serial',
      width: '130px',
      // The design's em dash for an asset with no serial recorded.
      render: (holding) => (
        <span className={styles.holdingSerial}>{holding.serialNumber ?? '—'}</span>
      ),
    },
    {
      header: 'Since',
      width: '130px',
      render: (holding) => (
        <span className={styles.muted}>since {formatFullDate(holding.checkedOutAt)}</span>
      ),
    },
    {
      header: '',
      width: '120px',
      align: 'right',
      render: (holding) =>
        can(role, 'assets.checkin') ? (
          <button
            type="button"
            className={styles.checkin}
            onClick={(event) => {
              event.stopPropagation();
              setCheckingIn(holding);
            }}
          >
            Check in →
          </button>
        ) : null,
    },
  ];

  return (
    <PageContainer variant="detail" maxWidth={1060} gap={16}>
      <BackLink to="/employees">Employees</BackLink>

      <div className={styles.header}>
        <Avatar name={employee.displayName} colorKey={employee.id} size={44} />
        <div style={{ marginRight: 'auto', minWidth: 0 }}>
          <div className={styles.headline}>
            <h1 className={styles.title}>{employee.displayName}</h1>
            <Pill sv={EMPLOYEE_STATUS_COLORS[employee.status]}>
              {EMPLOYEE_STATUS_LABELS[employee.status]}
            </Pill>
          </div>
          <div className={styles.meta}>{details.join(' · ')}</div>
        </div>
        {can(role, 'employees.edit') && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {can(role, 'assets.assign') && employee.status === 'active' && (
          <Button onClick={() => setAssigning(true)}>Assign asset</Button>
        )}
      </div>

      <DataTable
        title={`Currently holding · ${holdings.length}`}
        showHeader={false}
        columns={columns}
        rows={holdings}
        rowKey={(holding) => holding.id}
        onRowClick={(holding) => navigate(`/assets/${holding.assetId}`)}
        empty={<EmptyState>No assets currently assigned.</EmptyState>}
      />

      <Card title="Assignment history">
        {history.length === 0 ? (
          <div className={styles.note}>No previous assignments.</div>
        ) : (
          <div className={styles.history}>
            {history.map((holding) => (
              <button
                key={holding.id}
                type="button"
                className={styles.historyRow}
                onClick={() => navigate(`/assets/${holding.assetId}`)}
              >
                <span className={styles.historyText}>
                  <span className={styles.holdingName}>{holding.assetName}</span>
                  <span className={styles.holdingTag}>{holding.assetTag}</span>
                </span>
                <span className={styles.muted}>{historyRange(holding)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <EmployeeFormModal
          employee={employee}
          role={role}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate('/employees', { replace: true })}
        />
      )}
      {assigning && (
        <AssignModal
          mode="pick-asset"
          employeeId={employee.id}
          employeeName={employee.displayName}
          onClose={() => setAssigning(false)}
        />
      )}
      {checkingIn && (
        <CheckInModal
          asset={{
            id: checkingIn.assetId,
            assetTag: checkingIn.assetTag,
            currentHolder: {
              employeeId: employee.id,
              name: employee.displayName,
              checkedOutAt: checkingIn.checkedOutAt,
              expectedReturnDate: checkingIn.expectedReturnDate,
            },
          }}
          onClose={() => setCheckingIn(null)}
        />
      )}
    </PageContainer>
  );
}
