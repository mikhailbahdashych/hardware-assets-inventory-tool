import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, isNavItemActive, navItemsForRole } from './nav';

describe('navItemsForRole', () => {
  it('shows Admin only to admins, in the design order', () => {
    expect(navItemsForRole('admin').map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
      'Admin',
    ]);
    expect(navItemsForRole('manager').map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
    ]);
    expect(navItemsForRole('viewer').map((item) => item.label)).toEqual([
      'Dashboard',
      'Assets',
      'Employees',
      'Members',
    ]);
  });

  it('separates Admin from the rest with the design gap', () => {
    const admin = navItemsForRole('admin');
    expect(admin.at(-1)).toMatchObject({ label: 'Admin', to: '/admin', gapBefore: true });
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
    expect(breadcrumbForPath('/admin/activity')).toBe('Admin');
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
