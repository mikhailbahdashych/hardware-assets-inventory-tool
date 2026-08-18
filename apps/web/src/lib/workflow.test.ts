import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_STATUSES,
  type WorkflowPayload,
  type WorkflowStatus,
} from '@inventory/shared';
import { allowedTargets, checkinTargets, statusInfo, statusMap } from './workflow';

/** The seeded workflow, as `GET /workflow` serves it: sort order is list order. */
const STATUSES: WorkflowStatus[] = DEFAULT_ASSET_STATUSES.map((status, sortOrder) => ({
  ...status,
  sortOrder,
}));

const PAYLOAD: WorkflowPayload = {
  statuses: STATUSES,
  transitions: [
    { from: 'available', to: 'retired' },
    { from: 'available', to: 'in_repair' },
    { from: 'in_repair', to: 'available' },
  ],
};

describe('statusMap', () => {
  it('keys every status by its slug', () => {
    const map = statusMap(STATUSES);
    expect(map.size).toBe(6);
    expect(map.get('in_repair')).toMatchObject({ label: 'In repair', color: 'warn' });
  });
});

describe('statusInfo', () => {
  it('reads the label and colour an admin gave the status', () => {
    expect(statusInfo(statusMap(STATUSES), 'lost_stolen')).toEqual({
      label: 'Lost/Stolen',
      color: 'err',
    });
  });

  it('renders an unknown slug as itself, in neutral', () => {
    // Historical data only: a status somebody deleted, still on an old audit
    // event. Showing the slug beats hiding the row.
    expect(statusInfo(statusMap(STATUSES), 'on_loan')).toEqual({ label: 'on_loan', color: 'neut' });
  });
});

describe('allowedTargets', () => {
  it('offers the statuses the graph has an edge to, in sort order', () => {
    expect(allowedTargets(PAYLOAD, 'available').map((status) => status.id)).toEqual([
      'in_repair',
      'retired',
    ]);
  });

  it('offers nothing from a status with no outgoing edge', () => {
    expect(allowedTargets(PAYLOAD, 'retired')).toEqual([]);
    expect(allowedTargets(PAYLOAD, 'assigned')).toEqual([]);
  });
});

describe('checkinTargets', () => {
  it('offers only the statuses flagged as check-in destinations, in sort order', () => {
    expect(checkinTargets(STATUSES).map((status) => status.id)).toEqual([
      'available',
      'in_repair',
      'retired',
    ]);
  });

  it('follows the flags rather than the slugs', () => {
    const custom: WorkflowStatus[] = [
      { ...STATUSES[0]!, checkinTarget: false },
      {
        id: 'on_loan',
        label: 'On loan',
        color: 'info',
        isSystem: false,
        assignableFrom: false,
        checkinTarget: true,
        sortOrder: 9,
      },
    ];
    expect(checkinTargets(custom).map((status) => status.id)).toEqual(['on_loan']);
  });
});
