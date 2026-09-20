import { Fragment } from 'react';
import type { PaginationProps } from './types/pagination';
import styles from './Pagination.module.css';

/** How many pages flank the current one; the first and last are always drawn. */
const WINDOW = 1;

/**
 * Prev · numbered pages · Next, for the two lists long enough to need them.
 * One page needs no control at all, so it draws nothing rather than a dead row
 * of buttons.
 */
export function Pagination({ page, pageCount, onChange }: PaginationProps) {
  if (pageCount <= 1) return null;
  const pages = visiblePages(page, pageCount);

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
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
    </nav>
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
