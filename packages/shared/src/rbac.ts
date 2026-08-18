import type { ActionGroup, DefaultRole } from './types/roles.js';

// Which actions exist is a **product** decision, so the list is compiled in
// here with its UI copy and its grouping. Who may perform them is a
// **workspace** decision, so it is rows in `roles` + `role_permissions`, edited
// on the Roles page — the same enum-vs-table line the asset statuses are on.
//
// Reads are open to every authenticated member (a role with no grants at all is
// exactly today's viewer). Everything that mutates or is admin-only must be
// declared below, because a route with no action named on it is a route nothing
// guards.

export const ACTIONS = [
  'assets.create',
  'assets.edit',
  'assets.assign',
  'assets.checkin',
  'assets.change_status',
  'assets.manage_attachments',
  'assets.delete',
  'employees.create',
  'employees.edit',
  'employees.delete',
  'import.run',
  'members.manage',
  'custom_fields.manage',
  'workflow.manage',
  'roles.manage',
  'settings.manage',
  'audit.view',
  'export.run',
  'workspace.delete',
] as const;

// Derived from the list that declares them, per the convention: the value is
// the truth and a hand-written twin would drift.
export type Action = (typeof ACTIONS)[number];

/**
 * The one permission question, asked the same way by the API guard and by every
 * affordance the web draws — which is what keeps a button and the door behind
 * it from disagreeing.
 *
 * The first argument used to be a role, ranked viewer < manager < admin. It is
 * the resolved grant set now: `request.permissions` on the server, the
 * `permissions` `/auth/me` hands the browser. Nothing else changed, because a
 * rank was only ever a slow way of answering this.
 */
export function can(permissions: readonly Action[], action: Action): boolean {
  return permissions.includes(action);
}

/**
 * The one role id the code may name. Admin is the system role: always every
 * action including the ones a future version adds, never renamed, edited or
 * deleted — the same kind of anchor `ASSIGNED_STATUS` is for the workflow, and
 * for the same reason. It is what keeps a workspace administrable.
 */
export const ADMIN_ROLE = 'admin';

/** The matrix is a column per role; past ten it stops being readable. */
export const MAX_ROLES = 10;

/** The copy the matrix puts on each row — the action as a person would say it. */
export const ACTION_LABELS: Record<Action, string> = {
  'assets.create': 'Create assets',
  'assets.edit': 'Edit assets',
  'assets.assign': 'Assign assets',
  'assets.checkin': 'Check assets in',
  'assets.change_status': 'Change asset status',
  'assets.manage_attachments': 'Manage attachments',
  'assets.delete': 'Delete assets',
  'employees.create': 'Add employees',
  'employees.edit': 'Edit employees',
  'employees.delete': 'Delete employees',
  'members.manage': 'Manage members and invites',
  'import.run': 'Run CSV imports',
  'export.run': 'Export all data',
  'custom_fields.manage': 'Manage custom fields',
  'workflow.manage': 'Edit the workflow',
  'roles.manage': 'Manage roles and permissions',
  'settings.manage': 'Workspace settings',
  'audit.view': 'View the activity log',
  'workspace.delete': 'Delete the workspace',
};

/**
 * The matrix's header rows, in the order it draws them. Every action appears
 * under exactly one — a checkbox that is nowhere is a permission nobody can
 * grant, and one in two places is two ways to disagree. The test pins the
 * partition rather than trusting the eye.
 */
export const ACTION_GROUPS = [
  {
    label: 'Assets',
    actions: [
      'assets.create',
      'assets.edit',
      'assets.assign',
      'assets.checkin',
      'assets.change_status',
      'assets.manage_attachments',
      'assets.delete',
    ],
  },
  {
    label: 'Employees',
    actions: ['employees.create', 'employees.edit', 'employees.delete'],
  },
  { label: 'People', actions: ['members.manage'] },
  { label: 'Data', actions: ['import.run', 'export.run'] },
  {
    label: 'Administration',
    actions: [
      'custom_fields.manage',
      'workflow.manage',
      'roles.manage',
      'settings.manage',
      'audit.view',
      'workspace.delete',
    ],
  },
] as const satisfies readonly ActionGroup[];

/**
 * The roles a fresh instance is seeded with, and the legacy label map the audit
 * renderer falls back to for events written before roles became data.
 *
 * Array order is the seeded `sort_order`, and the grants reproduce exactly what
 * the role ranking above allowed — an upgraded instance already has these ids
 * in `members.role`, so it wakes up behaving precisely as it did.
 */
export const DEFAULT_ROLES = [
  {
    id: ADMIN_ROLE,
    label: 'Admin',
    description: 'Full access — settings, members, activity log',
    color: 'acc',
    isSystem: true,
    // Empty on purpose: the system role's permissions are `ACTIONS`, resolved
    // in one place rather than stored in rows a new action would miss.
    grants: [],
  },
  {
    id: 'manager',
    label: 'Manager',
    description: 'Create and edit assets, employees and assignments',
    color: 'info',
    isSystem: false,
    grants: [
      'assets.create',
      'assets.edit',
      'assets.assign',
      'assets.checkin',
      'assets.change_status',
      'assets.manage_attachments',
      'employees.create',
      'employees.edit',
      'import.run',
    ],
  },
  {
    id: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to all pages',
    color: 'neut',
    isSystem: false,
    // Reads are open to every authenticated member, so a role that grants
    // nothing is exactly the viewer this product has always had.
    grants: [],
  },
] as const satisfies readonly DefaultRole[];
