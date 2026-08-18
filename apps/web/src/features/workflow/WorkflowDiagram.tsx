import { ASSIGNED_STATUS, type WorkflowStatus } from '@inventory/shared';
import type {
  DiagramEdge,
  DiagramNode,
  Point,
  WorkflowDiagramProps,
} from './types/workflowDiagram';
import styles from './Workflow.module.css';

// The workflow, drawn. Hand-rolled SVG rather than a graph library: there are
// at most twenty nodes, the layout is a circle, and a dependency that draws
// boxes would still not know about `--{sv}` tokens or the two themes.
//
// Everything below is in the viewBox's own coordinates, so the drawing scales
// with whatever width it is given.

const VIEW = { width: 420, height: 360 };
const CENTRE = { x: 210, y: 172 };
const RADIUS = { x: 138, y: 112 };
const NODE = { width: 96, height: 28 };
/** Kept off the box so the arrowhead has somewhere to sit. */
const ARROW_GAP = 3;
/** How far a curve bows out, as a fraction of its length — enough that A→B and
 *  B→A are two visibly separate arcs rather than one line drawn twice. */
const BOW = 0.14;
/** Beyond this a label is cut; the full one stays in the node's <title>. */
const MAX_LABEL = 15;

/**
 * Where each status sits: the ones an asset moves between directly are spaced
 * around an ellipse in the workspace's own order, and the system status sits
 * in the middle of them — every assign arrow points into it and every check-in
 * arrow points back out.
 */
function layout(statuses: WorkflowStatus[]): DiagramNode[] {
  const outer = statuses.filter((status) => status.id !== ASSIGNED_STATUS);
  const step = (2 * Math.PI) / Math.max(outer.length, 1);
  let index = 0;
  return statuses.map((status) => {
    if (status.id === ASSIGNED_STATUS) return { status, ...CENTRE };
    // Starting at the top and going clockwise, which is how the list reads.
    const angle = -Math.PI / 2 + index++ * step;
    return {
      status,
      x: CENTRE.x + RADIUS.x * Math.cos(angle),
      y: CENTRE.y + RADIUS.y * Math.sin(angle),
    };
  });
}

/** Where a line from `towards` meets this node's box, plus the arrow's gap. */
function boundary(node: DiagramNode, towards: Point): Point {
  const dx = towards.x - node.x;
  const dy = towards.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  // The box is a rectangle, so the crossing is on whichever side the ray
  // reaches first — the smaller of the two scale factors.
  const scale = Math.min(
    dx === 0 ? Infinity : (NODE.width / 2 + ARROW_GAP) / Math.abs(dx),
    dy === 0 ? Infinity : (NODE.height / 2 + ARROW_GAP) / Math.abs(dy),
  );
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

/**
 * One quadratic curve from box to box, bowed to one side. The offset is
 * perpendicular to the line and takes its sign from the direction of travel,
 * so the two directions of a pair bow away from each other.
 */
function curve(from: DiagramNode, to: DiagramNode): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // Two nodes in the same place have no direction to bow along; a straight
  // line between them is the only honest answer.
  const bow = length === 0 ? { x: 0, y: 0 } : { x: (-dy / length) * length * BOW, y: (dx / length) * length * BOW }; // prettier-ignore
  const control = { x: (from.x + to.x) / 2 + bow.x, y: (from.y + to.y) / 2 + bow.y };
  const start = boundary(from, control);
  const end = boundary(to, control);
  return `M${round(start.x)} ${round(start.y)} Q${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`;
}

/** Two decimals is more than a 420-unit viewBox can show. */
const round = (value: number): number => Math.round(value * 100) / 100;

export function WorkflowDiagram({ statuses, transitions }: WorkflowDiagramProps) {
  const nodes = layout(statuses);
  const byId = new Map(nodes.map((node) => [node.status.id, node]));
  const assigned = byId.get(ASSIGNED_STATUS);

  const edge = (from: DiagramNode, to: DiagramNode, kind: DiagramEdge['kind']): DiagramEdge => ({
    key: `${kind}:${from.status.id}→${to.status.id}`,
    from: from.status.id,
    to: to.status.id,
    kind,
    path: curve(from, to),
  });

  const direct = transitions.flatMap((transition) => {
    const from = byId.get(transition.from);
    const to = byId.get(transition.to);
    // A graph naming a status this render was not given can only be a frame
    // between two queries. Drawing what can be placed beats throwing.
    return from && to ? [edge(from, to, 'direct')] : [];
  });

  // Assign and check-in are not transitions — they open and close an ownership
  // record — so they are drawn dashed, in from every status an asset can be
  // handed out of and back out to every status a return may land in.
  const dashed = assigned
    ? [
        ...nodes
          .filter((node) => node.status.assignableFrom)
          .map((node) => edge(node, assigned, 'assign')),
        ...nodes
          .filter((node) => node.status.checkinTarget)
          .map((node) => edge(assigned, node, 'checkin')),
      ]
    : [];

  return (
    <div className={styles.diagram}>
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className={styles.diagramCanvas}
        role="img"
        aria-label={`Workflow diagram: ${statuses.length} statuses, ${direct.length} direct moves`}
      >
        <defs>
          {/* Two heads rather than one that inherits: a marker cannot read the
              stroke of the path that used it in every browser this ships to. */}
          <marker
            id="workflow-arrow-direct"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 1L7 4L0 7z" fill="var(--faint)" />
          </marker>
          <marker
            id="workflow-arrow-dashed"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 1L7 4L0 7z" fill="var(--acc)" />
          </marker>
        </defs>

        {[...dashed, ...direct].map((line) => (
          <path
            key={line.key}
            d={line.path}
            data-edge={`${line.from}→${line.to}`}
            data-kind={line.kind}
            className={line.kind === 'direct' ? styles.edge : styles.edgeDashed}
            markerEnd={`url(#workflow-arrow-${line.kind === 'direct' ? 'direct' : 'dashed'})`}
          />
        ))}

        {nodes.map((node) => (
          <g key={node.status.id} data-node={node.status.id} className={styles.node}>
            <title>{node.status.label}</title>
            <rect
              x={round(node.x - NODE.width / 2)}
              y={round(node.y - NODE.height / 2)}
              width={NODE.width}
              height={NODE.height}
              rx="7"
              fill={`var(--${node.status.color}-bg)`}
              stroke={`var(--${node.status.color})`}
            />
            <text
              x={round(node.x)}
              y={round(node.y)}
              fill={`var(--${node.status.color})`}
              className={styles.nodeLabel}
            >
              {truncate(node.status.label)}
            </text>
          </g>
        ))}
      </svg>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} /> Change status
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLineDashed} /> Assign · Check in
        </span>
      </div>
    </div>
  );
}

/** The box is 96 units wide; a longer label is cut, and its title has it whole. */
function truncate(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}
