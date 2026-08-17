import type { can, Role } from '@inventory/shared';
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
  /** Omitted for the actions every role may take (there is one: the theme). */
  requires?: Parameters<typeof can>[1];
}

/** Everything `paletteGroups` needs: the query, the role, and the loaded lists. */
export interface PaletteInput {
  query: string;
  role: Role;
  assets: Asset[];
  employees: Employee[];
}
