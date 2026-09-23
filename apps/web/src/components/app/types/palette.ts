import type { Action, WorkflowStatus } from '@inventory/shared';
import type { SearchPayload } from '@/types/api';
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
  /** The nav's own flag: see `isAdmin` in `lib/roles.ts` for why it is a role. */
  adminOnly?: true;
}

/**
 * Everything `paletteGroups` needs: the query (for the command rows, which are
 * still matched here), the permissions, and what the server found. The asset
 * and employee rows arrive already searched and already capped — `/search` is
 * the one that reads the tables now.
 */
export interface PaletteInput {
  query: string;
  permissions: Action[];
  /** The role this member holds, for the one command gated on it. */
  role: string;
  results: SearchPayload;
  /** The workspace's statuses, so an asset row can name the one it carries. */
  statuses: WorkflowStatus[];
}
