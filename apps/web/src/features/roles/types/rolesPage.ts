import type { WorkspaceRole } from '@inventory/shared';

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
