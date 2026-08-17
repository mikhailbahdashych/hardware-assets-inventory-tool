import type { ReactNode } from 'react';
import type { TableColumn } from '@/types/table';

export interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Titled variant ("Currently holding · 3"), which the design draws without
   *  a column-header row — pass `showHeader={false}` with it. */
  title?: ReactNode;
  /** Accessible name. Needed when a page draws more than one table. */
  label?: string;
  showHeader?: boolean;
  footer?: ReactNode;
  /** Rendered instead of rows when the list is empty. */
  empty?: ReactNode;
}
