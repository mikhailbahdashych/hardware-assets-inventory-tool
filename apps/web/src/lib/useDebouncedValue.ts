import { useEffect, useState } from 'react';

/**
 * How long a list search sits on a keystroke before it becomes a request. Long
 * enough that typing a word is one query rather than five, short enough that
 * the table follows the input rather than lagging behind it.
 */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * The trailing edge of a value that changes as fast as somebody types. The
 * three list pages put this in the query key, not the raw input, so a search
 * box is still instant while the network is asked once.
 *
 * No named props type: it is one generic value and one delay, so there is no
 * shape to declare — see the `types/` rule in apps/web/CLAUDE.md.
 */
export function useDebouncedValue<T>(value: T, delay = SEARCH_DEBOUNCE_MS): T {
  // The first value is the value: a first paint has nothing to wait for.
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
