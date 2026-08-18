import type { WorkflowPayload, WorkflowStatus } from '@inventory/shared';
import type { StatusInfo } from './types/workflow';

// Statuses are rows an admin edits, not an enum this build knows, so every
// screen that draws one reads `useWorkflow()` and looks the slug up here.
// These four helpers are the whole vocabulary — labels, colours, and the two
// questions the modals ask: where may this asset go, and where may it land.

/**
 * What a screen renders before the query answers. The rule, not a rescue: a
 * workflow that has not arrived has no statuses to draw, and the pages that
 * need one wait for it rather than guessing.
 */
export const EMPTY_WORKFLOW: WorkflowPayload = { statuses: [], transitions: [] };

export function statusMap(statuses: WorkflowStatus[]): Map<string, WorkflowStatus> {
  return new Map(statuses.map((status) => [status.id, status]));
}

/**
 * The label and colour for a stored slug. A miss is historical data — an audit
 * event naming a status that has since been deleted — so it renders as itself
 * in neutral. That is the same rule the audit renderer follows: a log that
 * hides an event is worse than an ugly one.
 */
export function statusInfo(map: Map<string, WorkflowStatus>, id: string): StatusInfo {
  const status = map.get(id);
  return status ? { label: status.label, color: status.color } : { label: id, color: 'neut' };
}

/** One order everywhere — pills, tiles, selects and the matrix all read it. */
const inSortOrder = (statuses: WorkflowStatus[]): WorkflowStatus[] =>
  [...statuses].sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * Where the Change-status modal may move an asset: the graph's outgoing edges,
 * and nothing else. `assigned` has none in either direction, which is what
 * makes assign and check-in its only doors.
 */
export function allowedTargets(payload: WorkflowPayload, from: string): WorkflowStatus[] {
  const targets = new Set(
    payload.transitions.filter((edge) => edge.from === from).map((edge) => edge.to),
  );
  return inSortOrder(payload.statuses).filter((status) => targets.has(status.id));
}

/** Where a checked-in asset may land. The API has no such helper: this is the flag. */
export function checkinTargets(statuses: WorkflowStatus[]): WorkflowStatus[] {
  return inSortOrder(statuses).filter((status) => status.checkinTarget);
}
