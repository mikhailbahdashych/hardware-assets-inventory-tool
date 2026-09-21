import type { WorkflowStatus } from '@inventory/shared';
import type { StatusFilter } from '@/types/filters';

// The chosen values live in the URL (`/assets?status=&q=`) so a filtered view is
// shareable, survives a reload, and can be linked to from the dashboard. The
// matching itself is the server's — see `listAssets` in apps/api.

/**
 * No `?status=` in the URL, or one this workspace has no status for, both mean
 * "unfiltered" — a link to a status somebody has since deleted shows the whole
 * inventory rather than an empty table nobody can explain.
 */
export function parseStatusFilter(value: string | null, statuses: WorkflowStatus[]): StatusFilter {
  return value !== null && statuses.some((status) => status.id === value) ? value : 'all';
}

/**
 * "All 13 · Available 2 · …" — every status the workspace has is always
 * offered, including the ones at zero, so the row does not reflow as inventory
 * changes. Labels and order come from the workflow; the numbers come from the
 * payload, counted under the search but not under the pill you just pressed.
 */
export function assetStatusPills(
  total: number,
  counts: Record<string, number>,
  statuses: WorkflowStatus[],
) {
  return [
    { value: 'all', label: 'All', count: total },
    ...[...statuses]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((status) => ({
        value: status.id,
        label: status.label,
        // A status the payload does not mention has nothing under it — a miss
        // that is a genuine zero, not a count that failed to arrive.
        count: counts[status.id] ?? 0,
      })),
  ];
}
