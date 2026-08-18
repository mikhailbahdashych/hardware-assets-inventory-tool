import type { Action, WorkspaceRole } from '@inventory/shared';

/**
 * The page is told which role the person reading it holds, because that is the
 * one row they may not touch — the same family of rule as "nobody may change or
 * remove their own account", and what stops anybody granted `roles.manage` from
 * quietly promoting themselves.
 */
export interface RolesPageProps {
  ownRole: string;
}

/** The roles card, fed the list the page already has. */
export interface RolesCardProps {
  roles: WorkspaceRole[];
  ownRole: string;
}

/**
 * The permissions matrix. It is given the stored grants and edits a copy: the
 * page re-mounts it whenever those change, which re-seeds the draft.
 */
export interface PermissionsCardProps {
  roles: WorkspaceRole[];
  ownRole: string;
}

/**
 * One line of the matrix. A band names an area and carries no boxes; an action
 * row carries one per role. Both are rows of the same table because the group
 * is a fact about the actions under it, not a second table.
 */
export type MatrixRow =
  { kind: 'group'; key: string; label: string } | { kind: 'action'; key: string; action: Action };
