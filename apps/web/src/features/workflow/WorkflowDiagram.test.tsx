import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSET_STATUSES, type WorkflowStatus } from '@inventory/shared';
import { WorkflowDiagram } from './WorkflowDiagram';

const STATUSES: WorkflowStatus[] = DEFAULT_ASSET_STATUSES.map((status, sortOrder) => ({
  ...status,
  sortOrder,
}));

/** The seeded mesh: every non-assigned status to every other. */
const MESH = STATUSES.filter((status) => !status.isSystem).flatMap((from) =>
  STATUSES.filter((to) => !to.isSystem && to.id !== from.id).map((to) => ({
    from: from.id,
    to: to.id,
  })),
);

const draw = (transitions = MESH) => {
  const { container } = render(<WorkflowDiagram statuses={STATUSES} transitions={transitions} />);
  return {
    nodes: [...container.querySelectorAll('[data-node]')].map((node) => node.getAttribute('data-node')), // prettier-ignore
    edges: (kind: string) =>
      [...container.querySelectorAll(`[data-kind="${kind}"]`)].map((edge) =>
        edge.getAttribute('data-edge'),
      ),
  };
};

describe('WorkflowDiagram', () => {
  it('draws every status once, the system one included', () => {
    expect(draw().nodes).toEqual([
      'available',
      'assigned',
      'in_repair',
      'ordered',
      'retired',
      'lost_stolen',
    ]);
  });

  it('draws the graph it is given, one edge per direction', () => {
    const { edges } = draw();
    expect(edges('direct')).toHaveLength(20);
    expect(edges('direct')).toContain('available→retired');
    expect(edges('direct')).toContain('retired→available');
  });

  it('draws assign and check-in as the dashed edges of the system status', () => {
    const { edges } = draw();
    // Two statuses an asset can be handed out from, three a return may land in.
    expect(edges('assign')).toEqual(['available→assigned', 'ordered→assigned']);
    expect(edges('checkin')).toEqual([
      'assigned→available',
      'assigned→in_repair',
      'assigned→retired',
    ]);
  });

  it('loses an edge the moment the workflow does', () => {
    const { edges } = draw(MESH.filter((edge) => edge.from !== 'available' || edge.to !== 'retired')); // prettier-ignore
    expect(edges('direct')).toHaveLength(19);
    expect(edges('direct')).not.toContain('available→retired');
    // The other direction is its own edge and stays.
    expect(edges('direct')).toContain('retired→available');
  });

  it('ignores an edge naming a status it was not given', () => {
    // A graph and a status list that disagree can only be a stale render; the
    // diagram draws what it can place rather than throwing over a frame.
    const { edges } = draw([...MESH, { from: 'available', to: 'gone' }]);
    expect(edges('direct')).toHaveLength(20);
  });
});
