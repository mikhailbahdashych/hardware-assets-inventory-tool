import type { Action } from '@inventory/shared';

export interface CommandPaletteProps {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
  /** The role they hold, for the one command gated on it rather than a grant. */
  role: string;
  onClose: () => void;
}
