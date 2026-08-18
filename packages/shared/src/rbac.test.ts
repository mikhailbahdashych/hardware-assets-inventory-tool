import { describe, expect, it } from 'vitest';
import { ACTIONS, can, type Action } from './rbac.js';

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
  'settings.manage',
  'audit.view',
  'export.run',
  'workspace.delete',
];

describe('can', () => {
  it('lets viewers do nothing beyond reading', () => {
    for (const action of ACTIONS) {
      expect(can('viewer', action), `viewer should not ${action}`).toBe(false);
    }
  });

  it('lets managers create and edit inventory but not administer', () => {
    for (const action of MANAGER_ACTIONS) {
      expect(can('manager', action), `manager should ${action}`).toBe(true);
    }
    for (const action of ADMIN_ACTIONS) {
      expect(can('manager', action), `manager should not ${action}`).toBe(false);
    }
  });

  it('lets admins do everything', () => {
    for (const action of ACTIONS) {
      expect(can('admin', action), `admin should ${action}`).toBe(true);
    }
  });

  it('covers every declared action in this matrix', () => {
    expect(new Set(ACTIONS)).toEqual(new Set([...MANAGER_ACTIONS, ...ADMIN_ACTIONS]));
  });
});
