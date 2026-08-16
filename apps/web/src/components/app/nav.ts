import { can, type Role } from '@inventory/shared';
import type { IconName } from '../ui/Icon';

export type NavItem = {
  label: string;
  to: string;
  icon: IconName;
  /** The design separates Admin from the other sections with a 10px gap. */
  gapBefore?: boolean;
};

const ITEMS: (NavItem & { requires?: Parameters<typeof can>[1] })[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'grid' },
  { label: 'Assets', to: '/assets', icon: 'cube' },
  { label: 'Employees', to: '/employees', icon: 'users' },
  { label: 'Members', to: '/members', icon: 'shieldCheck' },
  { label: 'Admin', to: '/admin', icon: 'gear', gapBefore: true, requires: 'audit.view' },
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
  admin: 'Admin',
};

/**
 * Topbar breadcrumb: the section name, plus a detail label when one is known
 * ("Assets / AST-0142"). Detail pages show the section alone while loading.
 */
export function breadcrumbForPath(pathname: string, detailLabel?: string): string {
  const [section, detail] = pathname.split('/').filter(Boolean);
  const label = SECTION_LABELS[section ?? ''];
  if (!label) return '';
  if (section === 'admin' || !detail) return label;
  return detailLabel ? `${label} / ${detailLabel}` : label;
}
