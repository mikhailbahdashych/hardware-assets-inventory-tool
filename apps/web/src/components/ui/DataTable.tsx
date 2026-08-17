import type { ReactNode } from 'react';
import type { TableColumn } from '@/types/table';
import styles from './DataTable.module.css';

/**
 * The design's CSS-grid table: --thead header, 1px-divided rows whose vertical
 * padding is var(--rp) (12px comfortable / 7px compact), faint footer line.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  title,
  showHeader = true,
  footer,
  empty,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Titled variant ("Currently holding · 3"), which the design draws without
   *  a column-header row — pass `showHeader={false}` with it. */
  title?: ReactNode;
  showHeader?: boolean;
  footer?: ReactNode;
  /** Rendered instead of rows when the list is empty. */
  empty?: ReactNode;
}) {
  const template = columns.map((column) => column.width).join(' ');
  return (
    <div className={styles.table} role="table">
      {title !== undefined && <div className={styles.tableTitle}>{title}</div>}
      {showHeader && (
        <div
          className={styles.header}
          data-testid="table-header"
          role="row"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((column, index) => (
            <div key={index} role="columnheader" data-align={column.align} className={styles.cell}>
              {column.header}
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 && empty}
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          className={styles.row}
          data-clickable={Boolean(onRowClick)}
          role="row"
          tabIndex={onRowClick ? 0 : undefined}
          style={{ gridTemplateColumns: template }}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) {
                    onRowClick(row);
                  }
                }
              : undefined
          }
        >
          {columns.map((column, index) => (
            <div key={index} role="cell" data-align={column.align} className={styles.cell}>
              {column.render(row)}
            </div>
          ))}
        </div>
      ))}
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
