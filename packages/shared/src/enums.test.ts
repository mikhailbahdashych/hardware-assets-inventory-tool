import { describe, expect, it } from 'vitest';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSIGNED_STATUS,
  ASSIGNMENT_OUTCOMES,
  ASSIGNMENT_OUTCOME_LABELS,
  AUDIT_TYPES,
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  CHECKIN_CONDITIONS,
  CHECKIN_CONDITION_LABELS,
  CURRENCIES,
  CURRENCY_LABELS,
  DEFAULT_ASSET_STATUSES,
  DEPARTMENT_SUGGESTIONS,
  MAX_ASSET_STATUSES,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_COLORS,
  EMPLOYEE_STATUS_LABELS,
  MEMBER_STATUSES,
  MEMBER_STATUS_COLORS,
  MEMBER_STATUS_LABELS,
  ROLES,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SEMANTIC_COLORS,
} from './enums.js';

/**
 * Statuses are rows an admin edits, so there is no enum left to pin. What is
 * still worth pinning is the workflow a fresh instance is seeded with: it has
 * to reproduce the product's old behaviour exactly, or upgrading an instance
 * would quietly change what its inventory says.
 */
describe('the default workflow', () => {
  it('seeds the six design statuses, in the order the design lists them', () => {
    expect(DEFAULT_ASSET_STATUSES.map((entry) => entry.id)).toEqual([
      'available',
      'assigned',
      'in_repair',
      'ordered',
      'retired',
      'lost_stolen',
    ]);
  });

  it('labels and colors every one of them exactly as the design writes it', () => {
    expect(DEFAULT_ASSET_STATUSES.map((entry) => [entry.id, entry.label, entry.color])).toEqual([
      ['available', 'Available', 'ok'],
      ['assigned', 'Assigned', 'acc'],
      ['in_repair', 'In repair', 'warn'],
      ['ordered', 'Ordered', 'info'],
      ['retired', 'Retired', 'neut'],
      ['lost_stolen', 'Lost/Stolen', 'err'],
    ]);
  });

  it('only uses known semantic colors', () => {
    for (const entry of DEFAULT_ASSET_STATUSES) {
      expect(SEMANTIC_COLORS, entry.id).toContain(entry.color);
    }
  });

  it('marks one status as the system one, and it is assigned', () => {
    const system = DEFAULT_ASSET_STATUSES.filter((entry) => entry.isSystem);
    expect(system.map((entry) => entry.id)).toEqual([ASSIGNED_STATUS]);
    expect(ASSIGNED_STATUS).toBe('assigned');
  });

  it('hands out from Available and Ordered, exactly as the code does today', () => {
    expect(
      DEFAULT_ASSET_STATUSES.filter((entry) => entry.assignableFrom).map((entry) => entry.id),
    ).toEqual(['available', 'ordered']);
  });

  it('offers the three check-in destinations the check-in modal offered before', () => {
    expect(
      DEFAULT_ASSET_STATUSES.filter((entry) => entry.checkinTarget).map((entry) => entry.id),
    ).toEqual(['available', 'in_repair', 'retired']);
  });

  it('caps a workspace at a matrix a person can still read', () => {
    expect(MAX_ASSET_STATUSES).toBe(20);
    expect(DEFAULT_ASSET_STATUSES.length).toBeLessThanOrEqual(MAX_ASSET_STATUSES);
  });
});

describe('categories', () => {
  it('covers the five seeded categories with display labels', () => {
    expect(ASSET_CATEGORIES).toEqual(['laptops', 'desktops', 'monitors', 'phones', 'peripherals']);
    expect(ASSET_CATEGORY_LABELS.laptops).toBe('Laptops');
    expect(ASSET_CATEGORY_LABELS.peripherals).toBe('Peripherals');
  });
});

describe('people enums', () => {
  it('colors employee statuses per design (Active green, Offboarding amber)', () => {
    expect(EMPLOYEE_STATUSES).toEqual(['active', 'offboarding']);
    expect(EMPLOYEE_STATUS_LABELS.offboarding).toBe('Offboarding');
    expect(EMPLOYEE_STATUS_COLORS).toEqual({ active: 'ok', offboarding: 'warn' });
  });

  it('colors member statuses per design (Active green, Invited blue)', () => {
    expect(MEMBER_STATUSES).toEqual(['active', 'invited']);
    expect(MEMBER_STATUS_LABELS.invited).toBe('Invited');
    expect(MEMBER_STATUS_COLORS).toEqual({ active: 'ok', invited: 'info' });
  });

  it('describes roles with the exact permission copy from the design', () => {
    expect(ROLES).toEqual(['admin', 'manager', 'viewer']);
    expect(ROLE_LABELS).toEqual({ admin: 'Admin', manager: 'Manager', viewer: 'Viewer' });
    expect(ROLE_COLORS).toEqual({ admin: 'acc', manager: 'info', viewer: 'neut' });
    expect(ROLE_DESCRIPTIONS).toEqual({
      admin: 'Full access — settings, members, activity log',
      manager: 'Create and edit assets, employees and assignments',
      viewer: 'Read-only access to all pages',
    });
  });

  it('suggests the design departments including Other', () => {
    expect(DEPARTMENT_SUGGESTIONS).toEqual([
      'Engineering',
      'Design',
      'IT Operations',
      'Finance',
      'Sales',
      'Marketing',
      'Other',
    ]);
  });
});

describe('check-in enums', () => {
  it('offers the three conditions', () => {
    expect(CHECKIN_CONDITIONS).toEqual(['good', 'needs_repair', 'damaged']);
    expect(CHECKIN_CONDITION_LABELS.needs_repair).toBe('Needs repair');
  });
});

describe('audit types', () => {
  it('matches the four filter pills and their colors', () => {
    expect(AUDIT_TYPES).toEqual(['assets', 'people', 'auth', 'system']);
    expect(AUDIT_TYPE_LABELS).toEqual({
      assets: 'Assets',
      people: 'People',
      auth: 'Auth',
      system: 'System',
    });
    expect(AUDIT_TYPE_COLORS).toEqual({
      assets: 'acc',
      people: 'info',
      auth: 'neut',
      system: 'warn',
    });
  });
});

describe('misc enums', () => {
  it('lists currencies with symbols and outcomes with labels', () => {
    expect(CURRENCIES).toEqual(['EUR', 'USD', 'GBP', 'PLN']);
    expect(CURRENCY_LABELS.PLN).toBe('PLN (zł)');
    expect(ASSIGNMENT_OUTCOMES).toEqual(['returned', 'upgraded', 'in_repair', 'offboarded']);
    expect(ASSIGNMENT_OUTCOME_LABELS.in_repair).toBe('in repair');
  });
});
