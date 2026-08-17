import { can, type Role } from '@inventory/shared';
import type { GatedNavItem, NavItem } from './types/nav';

const ITEMS: GatedNavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'grid' },
  { label: 'Assets', to: '/assets', icon: 'cube' },
  { label: 'Employees', to: '/employees', icon: 'users' },
  { label: 'Members', to: '/members', icon: 'shieldCheck' },
  // Both admin-only, together after the design's 10px gap.
  {
    label: 'Activity log',
    to: '/activity',
    icon: 'activity',
    gapBefore: true,
    requires: 'audit.view',
  },
  { label: 'Admin', to: '/admin', icon: 'gear', requires: 'settings.manage' },
];

/** Sidebar sections this role may see — Admin is admins-only. */
export function navItemsForRole(role: Role): NavItem[] {
  return ITEMS.filter((item) => !item.requires || can(role, item.requires)).map(
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
