import { describe, expect, it } from 'vitest';
import {
  ACTION_GROUPS,
  ACTION_LABELS,
  ACTIONS,
  ADMIN_ROLE,
  can,
  DEFAULT_ROLES,
  MAX_ROLES,
  type Action,
} from './rbac.js';

// The old role ranking, written down one last time: exactly what a manager
// could do and exactly what only an admin could, before either was a row. The
// seed has to reproduce it, or upgrading an instance would quietly give or take
// a permission from every manager in every workspace.
const MANAGER_ACTIONS: Action[] = [
  'assets.create',
  'assets.edit',
  'assets.assign',
  'assets.checkin',
  'assets.change_status',
  'assets.manage_attachments',
  'employees.create',
  'employees.edit',
  'import.run',
];

const ADMIN_ACTIONS: Action[] = [
  'assets.delete',
  'employees.delete',
  'members.manage',
  'custom_fields.manage',
  'workflow.manage',
  'roles.manage',
  'settings.manage',
  'audit.view',
  'export.run',
  'workspace.delete',
];

describe('can', () => {
  it('answers from the set a request resolved, not from a rank', () => {
    expect(can(MANAGER_ACTIONS, 'assets.create')).toBe(true);
    expect(can(MANAGER_ACTIONS, 'assets.delete')).toBe(false);
  });

  it('says no to everything for a role that grants nothing', () => {
    for (const action of ACTIONS) {
      expect(can([], action), `an empty set should not allow ${action}`).toBe(false);
    }
  });

  it('says yes to everything for the set the system role resolves to', () => {
    for (const action of ACTIONS) {
      expect(can(ACTIONS, action), `every action should allow ${action}`).toBe(true);
    }
  });

  it('covers every declared action across the two seeded halves', () => {
    expect(new Set(ACTIONS)).toEqual(new Set([...MANAGER_ACTIONS, ...ADMIN_ACTIONS]));
  });
});

describe('ACTION_GROUPS', () => {
  it('partitions the actions exactly — every one shown once, in one area', () => {
    const grouped = ACTION_GROUPS.flatMap((group) => group.actions);

    expect(grouped).toHaveLength(ACTIONS.length);
    expect(new Set(grouped)).toEqual(new Set(ACTIONS));
  });

  it('names the five areas of the matrix, in the order it draws them', () => {
    expect(ACTION_GROUPS.map((group) => group.label)).toEqual([
      'Assets',
      'Employees',
      'People',
      'Data',
      'Administration',
    ]);
  });

  it('labels every action as something other than its slug', () => {
    for (const action of ACTIONS) {
      expect(ACTION_LABELS[action], action).toBeTruthy();
      expect(ACTION_LABELS[action], action).not.toBe(action);
    }
  });
});

describe('DEFAULT_ROLES', () => {
  const roleFor = (id: string) => DEFAULT_ROLES.find((role) => role.id === id)!;

  it('seeds the three roles a workspace has always had, in that order', () => {
    expect(DEFAULT_ROLES.map((role) => role.id)).toEqual(['admin', 'manager', 'viewer']);
    expect(DEFAULT_ROLES.map((role) => role.label)).toEqual(['Admin', 'Manager', 'Viewer']);
  });

  it('describes and colours them with the exact copy from the design', () => {
    expect(DEFAULT_ROLES.map((role) => [role.id, role.color, role.description])).toEqual([
      ['admin', 'acc', 'Full access — settings, members, activity log'],
      ['manager', 'info', 'Create and edit assets, employees and assignments'],
      ['viewer', 'neut', 'Read-only access to all pages'],
    ]);
  });

  it('makes Admin the one system role, and stores no permissions for it', () => {
    expect(DEFAULT_ROLES.filter((role) => role.isSystem).map((role) => role.id)).toEqual([
      ADMIN_ROLE,
    ]);
    // The system role's set is ACTIONS by definition, resolved rather than
    // stored — which is what makes a future action Admin's without a migration.
    expect(roleFor(ADMIN_ROLE).grants).toEqual([]);
  });

  /**
   * The zero-behaviour-change-on-upgrade promise, pinned. An instance that
   * upgrades keeps its `members.role` values and gets these grants; anything
   * else here would silently give or take a permission from every manager in
   * every workspace.
   */
  it('grants Manager exactly what the role ranking let a manager do', () => {
    expect([...roleFor('manager').grants].sort()).toEqual([...MANAGER_ACTIONS].sort());
  });

  it('grants Viewer nothing — reads are open, so an empty set is today’s viewer', () => {
    expect(roleFor('viewer').grants).toEqual([]);
  });

  it('grants only actions this build declares', () => {
    for (const role of DEFAULT_ROLES) {
      for (const action of role.grants) {
        expect(ACTIONS, `${role.id} grants ${action}`).toContain(action);
      }
    }
  });
});

describe('MAX_ROLES', () => {
  it('caps a workspace at ten roles, because the matrix has to stay readable', () => {
    expect(MAX_ROLES).toBe(10);
    expect(DEFAULT_ROLES.length).toBeLessThan(MAX_ROLES);
  });
});
