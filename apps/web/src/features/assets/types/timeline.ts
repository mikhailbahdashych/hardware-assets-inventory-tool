import type { SemanticColor } from '@inventory/shared';

export interface TimelineEntry {
  id: string;
  title: string;
  range: string;
  sv: SemanticColor;
}
