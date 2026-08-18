import type { SemanticColor } from '@inventory/shared';

/** Everything a pill or a sidebar footer needs to draw a role: words and colour. */
export interface RoleInfo {
  label: string;
  color: SemanticColor;
}
