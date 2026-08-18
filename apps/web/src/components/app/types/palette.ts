import type { Action, WorkflowStatus } from '@inventory/shared';
import type { Asset, Employee } from '@/types/api';
import type { IconName } from '@/components/ui';
import type { GlobalModal } from '@/types/modals';

/** What choosing a row does. A union, so no row can mean two things at once. */
export type PaletteEffect =
  { kind: 'navigate'; to: string } | { kind: 'modal'; modal: GlobalModal } | { kind: 'theme' };

export interface PaletteRow {
  id: string;
  icon: IconName;
  title: string;
  /** The second line: "AST-0142 · Assigned", "Product Designer · Design". */
  subtitle: string;
  /** The right-hand word: which kind of thing this is. */
  hint: string;
  effect: PaletteEffect;
}

export interface PaletteGroup {
  label: string;
  rows: PaletteRow[];
}

export interface ActionDefinition {
  title: string;
  icon: IconName;
  effect: PaletteEffect;
  /** Omitted for the actions everybody may take (there is one: the theme). */
  requires?: Action;
}

/** Everything `paletteGroups` needs: the query, the permissions, the loaded lists. */
export interface PaletteInput {
  query: string;
  permissions: Action[];
  assets: Asset[];
  employees: Employee[];
  /** The workspace's statuses, so an asset row can name the one it carries. */
  statuses: WorkflowStatus[];
}
