import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_ROLES, type Action } from '@inventory/shared';
import { breadcrumbForPath, isNavItemActive, navItemsFor } from './nav';

/** The set the system role resolves to, and the one the seeded Manager gets. */
const EVERYTHING: Action[] = [...ACTIONS];
const MANAGER: Action[] = [...DEFAULT_ROLES.find((role) => role.id === 'manager')!.grants];

describe('navItemsFor', () => {
  it('shows the gated sections only to a set that holds their action', () => {
    expect(navItemsFor(EVERYTHING).map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
      'Activity log',
      'Workflow',
      'Roles',
      'Admin',
    ]);
    expect(navItemsFor(MANAGER).map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
    ]);
    expect(navItemsFor([]).map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
    ]);
  });

  it('reveals one gated section for the one action it names, and no others', () => {
    // The point of the whole feature: a workspace grants `audit.view` to a role
    // of its own and that role gets the Activity log, nothing more.
    expect(navItemsFor(['audit.view']).map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
      'Activity log',
    ]);
  });

  it('separates the admin-only sections from the rest with the design gap', () => {
    const admin = navItemsFor(EVERYTHING);
    expect(admin.at(-4)).toMatchObject({ label: 'Activity log', to: '/activity', gapBefore: true });
    expect(admin.at(-3)).toMatchObject({ label: 'Workflow', to: '/workflow' });
    expect(admin.at(-2)).toMatchObject({ label: 'Roles', to: '/roles' });
    expect(admin.at(-1)).toMatchObject({ label: 'Admin', to: '/admin' });
    // One gap, above the group — not one above each of them.
    expect(admin.filter((item) => item.gapBefore)).toHaveLength(1);
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
