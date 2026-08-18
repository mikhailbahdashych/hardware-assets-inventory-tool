import type { WorkspaceRole } from '@inventory/shared';
import type { RoleInfo } from './types/roles';

// Roles are rows an admin edits, not an enum this build knows, so every screen
// that names one reads `useRoles()` and looks the id up here — the same
// arrangement as `lib/workflow.ts`, and for the same reason.

export function roleMap(roles: WorkspaceRole[]): Map<string, WorkspaceRole> {
  return new Map(roles.map((role) => [role.id, role]));
}

/**
 * The label and colour for a stored role id. A miss is an account whose role an
 * admin has since deleted — a state the API's delete-with-migrate makes rare
 * rather than impossible — so it renders as itself in neutral. The same rule
 * `statusInfo` follows: a list that hides a row is worse than an ugly one.
 */
export function roleInfo(map: Map<string, WorkspaceRole>, id: string): RoleInfo {
  const role = map.get(id);
  return role ? { label: role.label, color: role.color } : { label: id, color: 'neut' };
}

/**
 * The safest role to offer as an invitation's default: the one granting the
 * fewest actions, ties going to whichever the workspace lists first. That is
 * Viewer on a fresh instance and still the least on one that has invented five
 * roles of its own — where a fixed slug would name a role that may not exist
 * and "the last row" would hand out whatever was added most recently.
 *
 * Undefined when there are no roles to choose from, which is the state before
 * the query answers.
 */
export function leastPrivileged(roles: WorkspaceRole[]): WorkspaceRole | undefined {
  return [...roles].sort((a, b) => a.permissions.length - b.permissions.length)[0];
}
