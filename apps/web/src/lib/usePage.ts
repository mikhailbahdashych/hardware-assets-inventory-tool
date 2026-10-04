import { useState } from 'react';
import type { PageState } from './types/page';

/**
 * The page a paged list is on, and the two rules that keep it honest.
 *
 * - **Back to one when `resetOn` changes.** Pass the *debounced* search, not
 *   the input: resetting on the keystroke let a page picked while the search
 *   was still settling land on the new list. Reset during render, so the old
 *   page is never asked for with the new search.
 * - **Never past the last page.** Removing the only row on the last page left
 *   the reader on a page that no longer exists, which the list drew as an
 *   empty workspace. `clampTo` steps back instead — also during render, so the
 *   empty page is never drawn. An empty list is still one page, not zero.
 */
export function usePage(resetOn = ''): PageState {
  const [page, setPage] = useState(1);
  const [pageFor, setPageFor] = useState(resetOn);
  if (pageFor !== resetOn) {
    setPageFor(resetOn);
    setPage(1);
  }

  const clampTo = (total: number, size: number): number => {
    const last = Math.max(1, Math.ceil(total / size));
    if (page > last) setPage(last);
    return last;
  };

  return { page, setPage, clampTo };
}
