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

/** A nav item plus the permission that reveals it, if it needs one. */
export interface GatedNavItem extends NavItem {
  requires?: Action;
}
