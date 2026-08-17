import type { Action } from '@inventory/shared';
import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  label: string;
  to: string;
  icon: IconName;
  /** The design separates Admin from the other sections with a 10px gap. */
  gapBefore?: boolean;
}

/** A nav item plus the permission that reveals it, if it needs one. */
export interface GatedNavItem extends NavItem {
  requires?: Action;
}
