import type { WorkflowStatus, WorkflowTransition } from '@inventory/shared';

export interface WorkflowDiagramProps {
  statuses: WorkflowStatus[];
  /** The graph to draw — the page passes its draft, so it redraws live. */
  transitions: WorkflowTransition[];
}

/** A status, placed. The centre of its box in the diagram's own coordinates. */
export interface DiagramNode {
  status: WorkflowStatus;
  x: number;
  y: number;
}

/** A point in those coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** One drawn edge: which move it is, and the curve that says so. */
export interface DiagramEdge {
  key: string;
  from: string;
  to: string;
  /** Solid moves are the graph; the dashed pair are assign and check-in. */
  kind: 'direct' | 'assign' | 'checkin';
  path: string;
}
