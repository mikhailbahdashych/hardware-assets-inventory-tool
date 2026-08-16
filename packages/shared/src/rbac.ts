import type { Role } from './enums.js';

export type { Role };

// Reads are open to every authenticated role (viewer = "Read-only access to
// all pages" — except Admin surfaces, which are actions below). Everything
// that mutates or is admin-only must be declared here; API guards and UI
// affordances both call can(), so this map is the single RBAC truth.

const MIN_ROLE = {
  'assets.create': 'manager',
  'assets.edit': 'manager',
  'assets.assign': 'manager',
  'assets.checkin': 'manager',
  'assets.change_status': 'manager',
  'assets.manage_attachments': 'manager',
  'assets.delete': 'admin',
  'employees.create': 'manager',
  'employees.edit': 'manager',
  'employees.delete': 'admin',
  'import.run': 'manager',
  'members.manage': 'admin',
  'custom_fields.manage': 'admin',
  'settings.manage': 'admin',
  'audit.view': 'admin',
  'export.run': 'admin',
  'workspace.delete': 'admin',
} as const satisfies Record<string, Role>;

export type Action = keyof typeof MIN_ROLE;
export const ACTIONS = Object.keys(MIN_ROLE) as Action[];

const RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

export function can(role: Role, action: Action): boolean {
  return RANK[role] >= RANK[MIN_ROLE[action]];
}
