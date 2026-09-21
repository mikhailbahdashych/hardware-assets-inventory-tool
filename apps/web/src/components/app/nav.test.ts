import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_ROLES, type Action } from '@inventory/shared';
import { breadcrumbForPath, isNavItemActive, navSectionsFor } from './nav';

/** The set the system role resolves to, and the one the seeded Manager gets. */
const EVERYTHING: Action[] = [...ACTIONS];
const MANAGER: Action[] = [...DEFAULT_ROLES.find((role) => role.id === 'manager')!.grants];

describe('navSectionsFor', () => {
  it('splits the inventory from workspace management, gating the workspace items', () => {
    const admin = navSectionsFor(EVERYTHING);
    expect(admin.inventory.map((item) => item.label)).toEqual(['Dashboard', 'Assets', 'Employees']);
    expect(admin.workspace.map((item) => item.label)).toEqual([
      'Members',
      'Activity log',
      'Workflow',
      'Custom fields',
      'Roles',
      'Admin',
    ]);

    // The inventory half is everybody's; the workspace half shrinks to what
    // the role may actually manage — Members stays, being an open page.
    const manager = navSectionsFor(MANAGER);
    expect(manager.inventory.map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
    ]);
    expect(manager.workspace.map((item) => item.label)).toEqual(['Members']);
    expect(navSectionsFor([]).workspace.map((item) => item.label)).toEqual(['Members']);
  });

  it('reveals one gated section for the one action it names, and no others', () => {
    // The point of the whole feature: a workspace grants `audit.view` to a role
    // of its own and that role gets the Activity log, nothing more.
    expect(navSectionsFor(['audit.view']).workspace.map((item) => item.label)).toEqual([
      'Members',
      'Activity log',
    ]);
  });
});

describe('isNavItemActive', () => {
  it('marks the section active on its own page', () => {
    expect(isNavItemActive('/assets', '/assets')).toBe(true);
    expect(isNavItemActive('/employees', '/employees')).toBe(true);
  });

  it('keeps the section active on detail pages', () => {
    expect(isNavItemActive('/assets', '/assets/AST-0142')).toBe(true);
    expect(isNavItemActive('/employees', '/employees/emp-1')).toBe(true);
    expect(isNavItemActive('/admin', '/admin/settings')).toBe(true);
  });

  it('does not mark unrelated sections active', () => {
    expect(isNavItemActive('/assets', '/employees')).toBe(false);
    expect(isNavItemActive('/dashboard', '/assets')).toBe(false);
  });

  it('does not treat a path prefix of a different word as a match', () => {
    expect(isNavItemActive('/asset', '/assets')).toBe(false);
  });
});

describe('breadcrumbForPath', () => {
  it('names each top-level section', () => {
    expect(breadcrumbForPath('/dashboard')).toBe('Dashboard');
    expect(breadcrumbForPath('/assets')).toBe('Assets');
    expect(breadcrumbForPath('/employees')).toBe('Employees');
    expect(breadcrumbForPath('/members')).toBe('Members');
    expect(breadcrumbForPath('/admin')).toBe('Admin');
    expect(breadcrumbForPath('/activity')).toBe('Activity log');
    expect(breadcrumbForPath('/workflow')).toBe('Workflow');
    expect(breadcrumbForPath('/custom-fields')).toBe('Custom fields');
    expect(breadcrumbForPath('/roles')).toBe('Roles');
  });

  it('appends the detail label when one is known', () => {
    expect(breadcrumbForPath('/assets/abc', 'AST-0142')).toBe('Assets / AST-0142');
    expect(breadcrumbForPath('/employees/abc', 'Maya Lindqvist')).toBe(
      'Employees / Maya Lindqvist',
    );
  });

  it('falls back to the section alone while a detail label is loading', () => {
    expect(breadcrumbForPath('/assets/abc')).toBe('Assets');
  });

  it('is empty for unknown paths', () => {
    expect(breadcrumbForPath('/nope')).toBe('');
  });
});
