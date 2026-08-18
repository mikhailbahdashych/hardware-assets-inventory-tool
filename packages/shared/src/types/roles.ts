import type { SemanticColor } from '../enums.js';
// Type-only, and deliberately circular with rbac.ts — the same arrangement as
// enums.ts and types/workflow.ts. `Action` is derived from the map that
// declares it, so it cannot move here; these shapes describe values that live
// there, so they cannot move back. Both sides erase at build.
import type { Action } from '../rbac.js';

// Roles are rows in `roles` rather than a code enum: an admin renames,
// recolors and regrants them on the Roles page, so no build knows a
// workspace's vocabulary ahead of time. What the *product* decides is which
// actions exist (rbac.ts); what a *workspace* decides is who may do them.

/**
 * One row of the seed a fresh instance starts with, and the label map the
 * audit renderer falls back to for events written before roles became data.
 */
export interface DefaultRole {
  /** The slug, derived from the label once — `members.role` carries it. */
  id: string;
  label: string;
  description: string;
  color: SemanticColor;
  /** True only for Admin: always every action, never edited or deleted. */
  isSystem: boolean;
  /**
   * What the seed grants. Empty for the system role on purpose: its set is
   * `ACTIONS` by definition, resolved rather than stored, which is what makes
   * an action added in a future version Admin's without a migration.
   */
  grants: readonly Action[];
}

/** One area of the permissions matrix — a header row and the actions under it. */
export interface ActionGroup {
  label: string;
  actions: readonly Action[];
}
