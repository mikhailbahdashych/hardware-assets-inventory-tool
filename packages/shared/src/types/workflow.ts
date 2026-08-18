import type { SemanticColor } from '../enums.js';

// The workflow both apps speak: the statuses an asset may be in and the moves
// allowed between them. Statuses are rows in `asset_statuses` rather than a
// code enum, so these are the shapes the API serializes and the web renders —
// no build knows the vocabulary ahead of time.

export interface WorkflowStatus {
  /** The slug, derived from the label once and immutable afterwards. */
  id: string;
  label: string;
  color: SemanticColor;
  /** True only for `assigned`: assign and check-in are its only doors. */
  isSystem: boolean;
  /** An asset in this status may be handed out. */
  assignableFrom: boolean;
  /** The check-in modal offers this as a destination. */
  checkinTarget: boolean;
  /** Drives pills, tiles, selects and the matrix — one order everywhere. */
  sortOrder: number;
}

/** One directed edge of the graph. `assigned` never appears in either field. */
export interface WorkflowTransition {
  from: string;
  to: string;
}

/** What `GET /api/v1/workflow` answers: statuses in sort order, plus edges. */
export interface WorkflowPayload {
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}
