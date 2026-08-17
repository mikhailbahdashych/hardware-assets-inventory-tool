import { describe, expect, it } from 'vitest';
import type { Assignment } from '@/types/api';
import { buildTimeline } from './timeline';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const ADDED = '2023-03-12T09:00:00.000Z';

function record(overrides: Partial<Assignment>): Assignment {
  return {
    id: overrides.checkedOutAt ?? 'a1',
    employeeId: 'emp-1',
    holderName: 'Maya Lindqvist',
    checkedOutAt: '2024-02-03',
    expectedReturnDate: null,
    returnedAt: null,
    outcome: null,
    checkoutNotes: null,
    checkinCondition: null,
    checkinNotes: null,
    ...overrides,
  };
}

describe('buildTimeline', () => {
  it('shows only where the asset came from when nobody has ever held it', () => {
    const entries = buildTimeline([], ADDED, NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: 'Added to inventory', range: 'Mar 2023', sv: 'ok' });
  });

  it('marks the current holder in accent and counts how long they have had it', () => {
    const entries = buildTimeline([record({ checkedOutAt: '2024-02-03' })], ADDED, NOW);
    expect(entries[0]).toMatchObject({
      title: 'Maya Lindqvist',
      range: 'Feb 2024 → present · 2 yrs 6 mo',
      sv: 'acc',
    });
    expect(entries.at(-1)!.title).toBe('Added to inventory');
  });

  it('names the outcome on a closed holding', () => {
    const entries = buildTimeline(
      [
        record({
          holderName: 'Elena Vasquez',
          checkedOutAt: '2023-04-14',
          returnedAt: '2024-01-28',
          outcome: 'offboarded',
        }),
      ],
      ADDED,
      NOW,
    );
    expect(entries.find((entry) => entry.title === 'Elena Vasquez')).toMatchObject({
      range: 'Apr 2023 → Jan 2024 · offboarded',
      sv: 'neut',
    });
  });

  it('fills the time between two holders with an in-stock gap', () => {
    const entries = buildTimeline(
      [
        record({ checkedOutAt: '2024-02-03' }),
        record({
          holderName: 'Elena Vasquez',
          checkedOutAt: '2023-04-14',
          returnedAt: '2024-01-28',
          outcome: 'returned',
        }),
      ],
      ADDED,
      NOW,
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      'Maya Lindqvist',
      'In stock',
      'Elena Vasquez',
      'Added to inventory',
    ]);
    expect(entries[1]).toMatchObject({ range: 'Jan 2024 → Feb 2024', sv: 'neut' });
  });

  it('draws no gap when the next holder took it the same day', () => {
    const entries = buildTimeline(
      [
        record({ checkedOutAt: '2024-01-28' }),
        record({
          holderName: 'Elena Vasquez',
          checkedOutAt: '2023-04-14',
          returnedAt: '2024-01-28',
          outcome: 'returned',
        }),
      ],
      ADDED,
      NOW,
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      'Maya Lindqvist',
      'Elena Vasquez',
      'Added to inventory',
    ]);
  });

  it('opens with an in-stock gap when the asset is back on the shelf', () => {
    const entries = buildTimeline(
      [record({ checkedOutAt: '2024-02-03', returnedAt: '2026-05-01', outcome: 'returned' })],
      ADDED,
      NOW,
    );
    expect(entries[0]).toMatchObject({
      title: 'In stock',
      range: 'May 2026 → present',
      sv: 'neut',
    });
    expect(entries[1].title).toBe('Maya Lindqvist');
  });

  it('is newest first, whatever order the records arrive in', () => {
    const entries = buildTimeline(
      [
        record({
          holderName: 'Elena Vasquez',
          checkedOutAt: '2023-04-14',
          returnedAt: '2024-01-28',
          outcome: 'returned',
        }),
        record({ checkedOutAt: '2024-02-03' }),
      ],
      ADDED,
      NOW,
    );
    expect(entries[0].title).toBe('Maya Lindqvist');
  });
});
