import type { Action } from '@inventory/shared';
import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  label: string;
  to: string;
  icon: IconName;
}

/**
 * The sidebar's two halves: the inventory everybody works in on top, and the
 * management of the workspace itself pinned to the bottom, above the member.
 */
export interface NavSections {
  inventory: NavItem[];
  workspace: NavItem[];
}

/**
 * A nav item plus what reveals it, if it needs anything: an action a workspace
 * can grant, or — for the one page no grant opens — the admin role itself.
 * Never both; a page is gated one way or the other.
 */
export interface GatedNavItem extends NavItem {
  requires?: Action;
  /** See `isAdmin` in `lib/roles.ts` for why this is a role and not an action. */
  adminOnly?: true;
}
