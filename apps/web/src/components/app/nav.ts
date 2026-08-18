import { can, type Action } from '@inventory/shared';
import type { GatedNavItem, NavItem } from './types/nav';

const ITEMS: GatedNavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'grid' },
  { label: 'Assets', to: '/assets', icon: 'cube' },
  { label: 'Employees', to: '/employees', icon: 'users' },
  { label: 'Members', to: '/members', icon: 'shieldCheck' },
  // The four that need an action of their own, together after the design's
  // 10px gap. Each names the permission that makes it useful; a workspace that
  // grants one of them to an ordinary role gets the item along with it.
  {
    label: 'Activity log',
    to: '/activity',
    icon: 'activity',
    gapBefore: true,
    requires: 'audit.view',
  },
  { label: 'Workflow', to: '/workflow', icon: 'workflow', requires: 'workflow.manage' },
  { label: 'Roles', to: '/roles', icon: 'key', requires: 'roles.manage' },
  { label: 'Admin', to: '/admin', icon: 'gear', requires: 'settings.manage' },
];

/**
 * The sections this member may see. Every gated item names an action rather
 * than a role, so a workspace that grants `audit.view` to its own "Auditor"
 * gets the Activity log in the sidebar without anybody teaching this file
 * about the role.
 */
export function navItemsFor(permissions: Action[]): NavItem[] {
  return ITEMS.filter((item) => !item.requires || can(permissions, item.requires)).map(
    ({ requires: _requires, ...item }) => item,
  );
}

/** A section stays active on its detail pages: /assets is active on /assets/:id. */
export function isNavItemActive(to: string, pathname: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  assets: 'Assets',
  employees: 'Employees',
  members: 'Members',
  activity: 'Activity log',
  workflow: 'Workflow',
  roles: 'Roles',
  admin: 'Admin',
};

/**
 * Topbar breadcrumb: the section name, plus a detail label when one is known
 * ("Assets / AST-0142"). Detail pages show the section alone while loading.
 */
export function breadcrumbForPath(pathname: string, detailLabel?: string | null): string {
  const [section, detail] = pathname.split('/').filter(Boolean);
  if (!section) return '';
  const label = SECTION_LABELS[section];
  if (!label) return '';
  if (section === 'admin' || !detail) return label;
  return detailLabel ? `${label} / ${detailLabel}` : label;
}
