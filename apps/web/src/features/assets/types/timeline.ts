import type { SemanticColor } from '@inventory/shared';

export interface TimelineEntry {
  id: string;
  title: string;
  range: string;
  /** What was written down at checkout and check-in; null when nothing was. */
  note: string | null;
  sv: SemanticColor;
}
