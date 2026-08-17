import type { QueryClient } from '@tanstack/react-query';

/**
 * One coarse invalidation for every inventory mutation.
 *
 * Assets, employees and their detail pages all read the same few rows, and a
 * write rarely touches only the record you were looking at — checking an asset
 * in changes the asset, the holder's page, and both lists. Naming subjects
 * meant every new mutation had to remember all of them, and check-in did not:
 * it knew the asset but had already dropped the holder. So this invalidates
 * every inventory surface by key prefix instead.
 *
 * At this scale a refetch is cheap; correctness is not. Extend this function
 * rather than invalidating ad hoc inside a mutation hook.
 */
const INVENTORY_PREFIXES = [['assets'], ['asset'], ['employees'], ['employee']];

export function invalidateInventory(queryClient: QueryClient): void {
  for (const queryKey of INVENTORY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey });
  }
}
