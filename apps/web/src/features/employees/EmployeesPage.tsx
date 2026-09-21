import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { can, EMPLOYEE_STATUS_COLORS, EMPLOYEE_STATUS_LABELS } from '@inventory/shared';
import { LIST_PAGE, useEmployees } from '@/api/queries';
import type { Employee } from '@/types/api';
import { ListToolbar } from '@/components/app/ListToolbar';
import { useModals } from '@/providers/ModalProvider';
import { PageContainer } from '@/components/app/PageContainer';
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  Pagination,
  Pill,
  SearchInput,
  Spinner,
} from '@/components/ui';
import type { TableColumn } from '@/types/table';
import { setParam } from '@/lib/searchParams';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { usePageSize } from '@/lib/usePageSize';
import type { EmployeesPageProps } from './types/employeesPage';
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

export function EmployeesPage({ permissions }: EmployeesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  // How many rows a page holds is the reader's choice, kept across visits.
  const [pageSize, setPageSize] = usePageSize('employees', LIST_PAGE);
  const navigate = useNavigate();
  const { openModal } = useModals();

  // No `?q=` in the URL legitimately means "no filter".
  const query = searchParams.get('q') ?? '';
  // The input stays instant; the request waits for the typing to stop.
  const debounced = useDebouncedValue(query);
  const setQuery = (value: string) => {
    const params = new URLSearchParams(searchParams);
    setParam(params, 'q', value);
    setSearchParams(params, { replace: true });
    // A different search is a different list; page three of it is not where
    // anybody meant to land.
    setPage(1);
  };

  const employees = useEmployees({
    // An empty search is no search: the parameter is left out of the key.
    q: debounced.trim() === '' ? undefined : debounced.trim(),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  // A payload that has not arrived has no rows and nothing to count.
  const rows = employees.data?.employees ?? [];
  const total = employees.data?.total ?? 0;

  return (
    <PageContainer maxWidth={1060}>
      <ListToolbar title="Employees" permissions={permissions}>
        {can(permissions, 'employees.create') && (
          <Button icon="plus" onClick={() => openModal('addEmployee')}>
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
          footer={`${total} ${total === 1 ? 'employee' : 'employees'}`}
          empty={
            <EmptyState>
              {query === ''
                ? 'No employees yet — add the people who will hold your assets.'
                : 'No employees match that filter.'}
            </EmptyState>
          }
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
            // A smaller page is a different list; page three of it is not
            // where anybody meant to land.
            setPage(1);
          },
        }}
      />
    </PageContainer>
  );
}
