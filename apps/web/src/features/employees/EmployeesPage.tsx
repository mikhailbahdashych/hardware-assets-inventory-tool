import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { can, EMPLOYEE_STATUS_COLORS, EMPLOYEE_STATUS_LABELS, type Role } from '@inventory/shared';
import { useEmployees } from '@/api/queries';
import type { Employee } from '@/types/api';
import { ListToolbar } from '@/components/app/ListToolbar';
import { PageContainer } from '@/components/app/PageContainer';
import { Avatar, Button, DataTable, EmptyState, Pill, SearchInput, Spinner } from '@/components/ui';
import type { TableColumn } from '@/types/table';
import { setParam } from '@/lib/searchParams';
import { EmployeeFormModal } from './EmployeeFormModal';
import { filterEmployees } from './filters';
import styles from './Employees.module.css';

/** The design's grid: Name · Email · Department · Location · Assets · Status. */
const COLUMNS: TableColumn<Employee>[] = [
  {
    header: 'Name',
    width: 'minmax(200px, 1.5fr)',
    render: (employee) => (
      <div className={styles.person}>
        <Avatar name={employee.displayName} colorKey={employee.id} size={26} />
        <div style={{ minWidth: 0 }}>
          <div className={styles.name}>{employee.displayName}</div>
          {/* The design's em dash for an empty cell, here and below. */}
          <div className={styles.sub}>{employee.jobTitle ?? '—'}</div>
        </div>
      </div>
    ),
  },
  {
    header: 'Email',
    width: '1.3fr',
    render: (employee) => <span className={styles.muted}>{employee.email}</span>,
  },
  { header: 'Department', width: '130px', render: (employee) => employee.department ?? '—' },
  {
    header: 'Location',
    width: '130px',
    render: (employee) => <span className={styles.muted}>{employee.location ?? '—'}</span>,
  },
  {
    header: 'Assets',
    width: '80px',
    render: (employee) => <span className={styles.count}>{employee.activeAssetCount}</span>,
  },
  {
    header: 'Status',
    width: '100px',
    render: (employee) => (
      <Pill sv={EMPLOYEE_STATUS_COLORS[employee.status]}>
        {EMPLOYEE_STATUS_LABELS[employee.status]}
      </Pill>
    ),
  },
];

export function EmployeesPage({ role }: { role: Role }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const employees = useEmployees();

  // No `?q=` in the URL legitimately means "no filter".
  const query = searchParams.get('q') ?? '';
  const setQuery = (value: string) => {
    const params = new URLSearchParams(searchParams);
    setParam(params, 'q', value);
    setSearchParams(params, { replace: true });
  };

  // A list that has not arrived has no rows; the empty state renders below.
  const all = employees.data ?? [];
  const rows = filterEmployees(all, query);

  return (
    <PageContainer maxWidth={1060}>
      <ListToolbar title="Employees">
        {can(role, 'employees.create') && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            Add employee
          </Button>
        )}
      </ListToolbar>

      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by name, email or department…"
        aria-label="Filter employees"
      />

      {employees.isPending ? (
        <div className={styles.loading}>
          <Spinner size={18} />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(employee) => employee.id}
          onRowClick={(employee) => navigate(`/employees/${employee.id}`)}
          footer={`${rows.length} ${rows.length === 1 ? 'employee' : 'employees'}`}
          empty={
            <EmptyState>
              {all.length === 0
                ? 'No employees yet — add the people who will hold your assets.'
                : 'No employees match that filter.'}
            </EmptyState>
          }
        />
      )}

      {creating && <EmployeeFormModal role={role} onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}
