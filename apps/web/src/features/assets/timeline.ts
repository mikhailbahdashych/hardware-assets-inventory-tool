import { ASSIGNMENT_OUTCOME_LABELS, type SemanticColor } from '@inventory/shared';
import type { Assignment } from '@/types/api';
import { formatDuration, formatMonthYear } from '@/lib/format';

// The design's ownership timeline. "In stock" spells and the "Added to
// inventory" origin are derived here at read time rather than stored as rows,
// so the database holds only what actually happened.

export type TimelineEntry = {
  id: string;
  title: string;
  range: string;
  sv: SemanticColor;
};

export function buildTimeline(
  assignments: Assignment[],
  assetCreatedAt: string,
  now: Date = new Date(),
): TimelineEntry[] {
  const ordered = [...assignments].sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt));
  const entries: TimelineEntry[] = [];

  // Nobody holds it now, but somebody did: it has been on the shelf since.
  const newest = ordered[0];
  if (newest?.returnedAt) {
    entries.push({
      id: `gap-now`,
      title: 'In stock',
      range: `${formatMonthYear(newest.returnedAt)} → present`,
      sv: 'neut',
    });
  }

  ordered.forEach((assignment, index) => {
    entries.push({
      id: assignment.id,
      title: assignment.holderName,
      range: assignment.returnedAt
        ? `${formatMonthYear(assignment.checkedOutAt)} → ${formatMonthYear(assignment.returnedAt)}${
            assignment.outcome ? ` · ${ASSIGNMENT_OUTCOME_LABELS[assignment.outcome]}` : ''
          }`
        : `${formatMonthYear(assignment.checkedOutAt)} → present · ${formatDuration(
            assignment.checkedOutAt,
            now.toISOString(),
          )}`,
      sv: assignment.returnedAt ? 'neut' : 'acc',
    });

    // A gap only exists if the older holding ended before this one began.
    const older = ordered[index + 1];
    if (older?.returnedAt && older.returnedAt < assignment.checkedOutAt) {
      entries.push({
        id: `gap-${assignment.id}`,
        title: 'In stock',
        range: `${formatMonthYear(older.returnedAt)} → ${formatMonthYear(assignment.checkedOutAt)}`,
        sv: 'neut',
      });
    }
  });

  entries.push({
    id: 'origin',
    title: 'Added to inventory',
    range: formatMonthYear(assetCreatedAt),
    sv: 'ok',
  });

  return entries;
}
