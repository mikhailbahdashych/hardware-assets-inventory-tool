import { describe, expect, it } from 'vitest';
import type { WorkflowTransition } from '@inventory/shared';
import {
  draftChanged,
  draftFromTransitions,
  draftKey,
  transitionsFromDraft,
} from './workflowDraft';

const STORED: WorkflowTransition[] = [
  { from: 'available', to: 'in_repair' },
  { from: 'in_repair', to: 'available' },
  { from: 'available', to: 'retired' },
];

describe('draftKey', () => {
  it('names one direction of one pair', () => {
    expect(draftKey('available', 'retired')).toBe('available→retired');
    expect(draftKey('retired', 'available')).not.toBe(draftKey('available', 'retired'));
  });
});

describe('the draft round trip', () => {
  it('turns the stored graph into a set and back into edges', () => {
    const draft = draftFromTransitions(STORED);
    expect(draft.size).toBe(3);
    expect(draft.has(draftKey('available', 'in_repair'))).toBe(true);
    expect(transitionsFromDraft(draft)).toEqual(
      expect.arrayContaining(STORED.map((edge) => ({ from: edge.from, to: edge.to }))),
    );
    expect(transitionsFromDraft(draft)).toHaveLength(3);
  });

  it('survives a status id with an underscore in it', () => {
    const draft = draftFromTransitions([{ from: 'lost_stolen', to: 'in_repair' }]);
    expect(transitionsFromDraft(draft)).toEqual([{ from: 'lost_stolen', to: 'in_repair' }]);
  });
});

describe('draftChanged', () => {
  it('is false for the same graph, whatever order it was built in', () => {
    const stored = draftFromTransitions(STORED);
    const draft = draftFromTransitions([...STORED].reverse());
    expect(draftChanged(stored, draft)).toBe(false);
  });

  it('is true when an edge is added or removed', () => {
    const stored = draftFromTransitions(STORED);

    const removed = new Set(stored);
    removed.delete(draftKey('available', 'retired'));
    expect(draftChanged(stored, removed)).toBe(true);

    const added = new Set(stored);
    added.add(draftKey('retired', 'available'));
    expect(draftChanged(stored, added)).toBe(true);
  });

  it('is true when one edge is swapped for another, not just counted', () => {
    const stored = draftFromTransitions(STORED);
    const swapped = new Set(stored);
    swapped.delete(draftKey('available', 'retired'));
    swapped.add(draftKey('retired', 'available'));
    expect(swapped.size).toBe(stored.size);
    expect(draftChanged(stored, swapped)).toBe(true);
  });
});
