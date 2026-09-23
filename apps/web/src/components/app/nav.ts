import { can, type Action } from '@inventory/shared';
import { isAdmin } from '@/lib/roles';
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
  {
    label: 'Custom fields',
    to: '/custom-fields',
    icon: 'tag',
    requires: 'custom_fields.manage',
  },
  { label: 'Roles', to: '/roles', icon: 'key', requires: 'roles.manage' },
  { label: 'API tokens', to: '/api-tokens', icon: 'terminal', adminOnly: true },
  { label: 'Admin', to: '/admin', icon: 'gear', requires: 'settings.manage' },
];

function allowed(items: GatedNavItem[], permissions: Action[], role: string): NavItem[] {
  return items
    .filter((item) =>
      item.adminOnly ? isAdmin(role) : !item.requires || can(permissions, item.requires),
    ) // prettier-ignore
    .map(({ requires: _requires, adminOnly: _adminOnly, ...item }) => item);
}

/**
 * The sections this member may see, split into the sidebar's two halves.
 * Almost every gated item names an action rather than a role, so a workspace
 * that grants `audit.view` to its own "Auditor" gets the Activity log without
 * anybody teaching this file about the role. API tokens is the exception and
 * takes the role itself — `isAdmin` in `lib/roles.ts` says why — which is why
 * this function is asked about the member rather than only their permissions.
 */
export function navSectionsFor(permissions: Action[], role: string): NavSections {
  return {
    inventory: allowed(INVENTORY_ITEMS, permissions, role),
    workspace: allowed(WORKSPACE_ITEMS, permissions, role),
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
  notifications: 'Notifications',
  activity: 'Activity log',
  workflow: 'Workflow',
  'custom-fields': 'Custom fields',
  roles: 'Roles',
  'api-tokens': 'API tokens',
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
