import type { SemanticColor } from '@inventory/shared';

/** Everything a pill, a tile or a dot needs to draw a status: words and colour. */
export interface StatusInfo {
  label: string;
  color: SemanticColor;
}
