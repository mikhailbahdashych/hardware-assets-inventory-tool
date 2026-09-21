import { Fragment, useId } from 'react';
import { PAGE_SIZES } from '@/lib/usePageSize';
import { Dropdown } from './Dropdown';
import type { PagerProps, PaginationProps, RowsPerPageProps } from './types/pagination';
import styles from './Pagination.module.css';

/** How many pages flank the current one; the first and last are always drawn. */
const WINDOW = 1;

/**
 * Prev · numbered pages · Next, with an optional "Rows per page" selector for
 * the lists that let you choose — the choice itself is remembered per list by
 * `usePageSize` in `lib/`, not by this control.
 *
 * One page needs no numbers, so it draws none rather than a dead row of
 * buttons; the selector stays, because thirty rows at fifty a page would
 * otherwise be a list with no way back to ten. No rows at all draws nothing
 * whatever: an empty state is not a table, and has nothing to size.
 */
export function Pagination({ page, pageCount, onChange, rowsPerPage }: PaginationProps) {
  if (pageCount < 1 || (pageCount === 1 && rowsPerPage === undefined)) return null;

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      {rowsPerPage && <RowsPerPage {...rowsPerPage} />}
      {pageCount > 1 && <Pager page={page} pageCount={pageCount} onChange={onChange} />}
    </nav>
  );
}

function Pager({ page, pageCount, onChange }: PagerProps) {
  const pages = visiblePages(page, pageCount);

  return (
    <>
      <button
        type="button"
        className={styles.step}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Prev
      </button>

      {pages.map((n, index) => (
        <Fragment key={n}>
          {/* A jump in the numbers is where the ellipsis goes. `index > 0` is
              the proof that the previous entry exists. */}
          {index > 0 && n - pages[index - 1]! > 1 && <span className={styles.gap}>…</span>}
          <button
            type="button"
            className={styles.page}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        </Fragment>
      ))}

      <button
        type="button"
        className={styles.step}
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </>
  );
}

/** The design's own select, sized down to the two digits it usually holds. */
function RowsPerPage({ size, options = PAGE_SIZES, onChange }: RowsPerPageProps) {
  const id = useId();
  return (
    <span className={styles.rows}>
      <label className={styles.rowsLabel} htmlFor={id}>
        Rows per page
      </label>
      <span className={styles.rowsControl}>
        <Dropdown
          id={id}
          value={String(size)}
          options={options.map((option) => ({ value: String(option), label: String(option) }))}
          onChange={(value) => onChange(Number(value))}
        />
      </span>
    </span>
  );
}

/**
 * The first page, the last page and a window around the current one, in order
 * and without repeats — an activity log runs to hundreds of pages, and every
 * one of them as a button is a scrollbar rather than a control.
 */
function visiblePages(page: number, pageCount: number): number[] {
  const wanted = new Set([1, pageCount]);
  for (let n = page - WINDOW; n <= page + WINDOW; n += 1) {
    if (n >= 1 && n <= pageCount) wanted.add(n);
  }
  return [...wanted].sort((a, b) => a - b);
}
