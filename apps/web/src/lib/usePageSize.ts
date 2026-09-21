import { useCallback, useState } from 'react';
import type { PageSizeState, PageSizeSurface } from './types/pageSize';

/**
 * The sizes every list offers. All five are inside the API's own ceiling — 200
 * for the three lists and the inbox, 500 for the audit log — so no option can
 * ask for a page the server refuses.
 */
export const PAGE_SIZES = [10, 25, 50, 100, 200];

/** One key per list, beside `inv.theme` and `inv.density`. */
const KEY_PREFIX = 'inv.rowsPerPage.';

/**
 * How many rows a list puts on a page, remembered across visits so nobody
 * re-picks it every morning. The value is the person's, not the workspace's,
 * which is why it lives in localStorage rather than in their member row.
 */
export function usePageSize(surface: PageSizeSurface, fallback: number): PageSizeState {
  // Read once, on mount: nothing else in the tab writes this key. Nothing
  // remembered — `stored` below lists every way of that — is this list's own
  // default, which is the one rule the fallback follows.
  const [size, setSize] = useState(() => stored(surface) ?? fallback);

  const choose = useCallback(
    (next: number) => {
      setSize(next);
      try {
        window.localStorage.setItem(KEY_PREFIX + surface, String(next));
      } catch {
        // Private mode or blocked site data: the choice holds for this visit
        // and is simply not there for the next one.
      }
    },
    [surface],
  );

  return [size, choose];
}

/**
 * The remembered size, or `null` for every way there might not be one: nothing
 * stored, storage that throws, or a number no longer on the menu — a size we
 * have since removed must not outlive it, and `Number` turns both `null` and
 * garbage into something `PAGE_SIZES` does not contain.
 */
function stored(surface: PageSizeSurface): number | null {
  try {
    const size = Number(window.localStorage.getItem(KEY_PREFIX + surface));
    return PAGE_SIZES.includes(size) ? size : null;
  } catch {
    return null;
  }
}
