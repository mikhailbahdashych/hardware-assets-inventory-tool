import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries';

/**
 * One coarse invalidation for every inventory mutation. Assets, employees and
 * (later) the dashboard and activity log all read from the same few rows, so a
 * surgical cache edit is easy to get subtly wrong and a refetch is cheap at
 * this scale. Extend this function rather than sprinkling invalidations
 * through mutation hooks — it is the list of surfaces a write can affect.
 */
export function invalidateInventory(
  queryClient: QueryClient,
  subject: { assetId?: string; employeeId?: string } = {},
): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.assets });
  queryClient.invalidateQueries({ queryKey: queryKeys.employees });
  if (subject.assetId)
    queryClient.invalidateQueries({ queryKey: queryKeys.asset(subject.assetId) });
  if (subject.employeeId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.employee(subject.employeeId) });
  }
}
