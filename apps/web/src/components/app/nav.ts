import { can, type Action } from '@inventory/shared';
import type { GatedNavItem, NavItem, NavSections } from './types/nav';

// What the workspace exists for: everybody's half.
const INVENTORY_ITEMS: GatedNavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'grid' },
  { label: 'Assets', to: '/assets', icon: 'cube' },
  { label: 'Employees', to: '/employees', icon: 'users' },
];

// Managing the workspace itself, pinned to the sidebar's bottom. Each gated
// item names the permission that makes it useful; a workspace that grants one
// of them to an ordinary role gets the item along with it. Members is open —
// reading who can sign in is a normal page — and Admin sits last, nearest the
// door it opens.
const WORKSPACE_ITEMS: GatedNavItem[] = [
  { label: 'Members', to: '/members', icon: 'shieldCheck' },
  { label: 'Activity log', to: '/activity', icon: 'activity', requires: 'audit.view' },
  { label: 'Workflow', to: '/workflow', icon: 'workflow', requires: 'workflow.manage' },
  { label: 'Roles', to: '/roles', icon: 'key', requires: 'roles.manage' },
  { label: 'Admin', to: '/admin', icon: 'gear', requires: 'settings.manage' },
];

function allowed(items: GatedNavItem[], permissions: Action[]): NavItem[] {
  return items
    .filter((item) => !item.requires || can(permissions, item.requires))
    .map(({ requires: _requires, ...item }) => item);
}

/**
 * The sections this member may see, split into the sidebar's two halves.
 * Every gated item names an action rather than a role, so a workspace that
 * grants `audit.view` to its own "Auditor" gets the Activity log without
 * anybody teaching this file about the role.
 */
export function navSectionsFor(permissions: Action[]): NavSections {
  return {
    inventory: allowed(INVENTORY_ITEMS, permissions),
    workspace: allowed(WORKSPACE_ITEMS, permissions),
  };
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
