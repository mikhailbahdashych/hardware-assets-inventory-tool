import { ACTIONS, type Action, type WorkspaceRole } from '@inventory/shared';
import type { RoleGrant } from '@/types/api';

// The permissions matrix edits every role's grant set at once, so the thing it
// edits is a set of pairs — one key per checked box. The same shape as
// `workflowDraft.ts` and `settingsDraft.ts`: the diff against what is stored
// *is* the dirty check, so the Save button and the payload can never disagree
// about whether there is anything to save.

/** One cell: the role down the column, the action along the row. */
export function draftKey(role: string, action: string): string {
  return `${role}:${action}`;
}

/**
 * The boxes the stored grants tick. The system role is left out on purpose: its
 * set is every action by definition rather than rows, and the API refuses a
 * grant naming it — so a draft that carried its column would be a draft that
 * cannot be saved.
 */
export function draftFromRoles(roles: WorkspaceRole[]): Set<string> {
  return new Set(
    roles
      .filter((role) => !role.isSystem)
      .flatMap((role) => role.permissions.map((action) => draftKey(role.id, action))),
  );
}

const IS_ACTION = new Set<string>(ACTIONS);

/** Narrows a parsed half of a key to the action list the product compiles in. */
function isAction(value: string): value is Action {
  return IS_ACTION.has(value);
}

/**
 * The grants the boxes hold, as the PUT sends them. A role id is a slug and an
 * action never contains a colon, so the first colon is the only one — but the
 * halves are still checked, because a key this file did not write means
 * somebody built a draft by hand and the throw is where they find out.
 */
export function grantsFromDraft(draft: Set<string>): RoleGrant[] {
  return [...draft].map((key) => {
    const separator = key.indexOf(':');
    const role = key.slice(0, separator);
    const action = key.slice(separator + 1);
    if (separator === -1 || role === '' || !isAction(action)) {
      throw new Error(`"${key}" is not a permission key.`);
    }
    return { role, action };
  });
}

/** Whether the draft differs from what is stored, in either direction. */
export function draftChanged(stored: Set<string>, draft: Set<string>): boolean {
  if (stored.size !== draft.size) return true;
  for (const key of draft) {
    if (!stored.has(key)) return true;
  }
  return false;
}
