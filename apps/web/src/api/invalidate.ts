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
const INVENTORY_PREFIXES = [['assets'], ['asset'], ['employees'], ['employee'], ['dashboard']];

export function invalidateInventory(queryClient: QueryClient): void {
  for (const queryKey of INVENTORY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * The same idea for the admin surfaces. Every member, role and settings write
 * also writes an audit event, and renaming the workspace changes `/meta`, so
 * they refresh together rather than each mutation remembering which it moved.
 *
 * `roles` is in here rather than beside the role mutations because the traffic
 * runs both ways: a role write changes what a member's pill says, and a member
 * write changes the member counts the Roles page reads. Splitting them would
 * mean inviting somebody left "2 members" on screen under the role they joined.
 */
const ADMIN_PREFIXES = [['members'], ['roles'], ['settings'], ['audit'], ['meta']];

export function invalidateAdmin(queryClient: QueryClient): void {
  for (const queryKey of ADMIN_PREFIXES) {
    queryClient.invalidateQueries({ queryKey });
  }
}
