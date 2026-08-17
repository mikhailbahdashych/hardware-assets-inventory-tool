import { describe, expect, it } from 'vitest';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUSES,
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  ASSIGNED_STATUS,
  ASSIGNMENT_OUTCOMES,
  ASSIGNMENT_OUTCOME_LABELS,
  AUDIT_TYPES,
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  CHECKIN_CONDITIONS,
  CHECKIN_CONDITION_LABELS,
  CHECKIN_NEW_STATUSES,
  CHECKIN_NEW_STATUS_LABELS,
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
  canDirectlyTransition,
} from './enums.js';

describe('asset statuses', () => {
  it('defines the six design statuses as slugs', () => {
    expect(ASSET_STATUSES).toEqual([
      'available',
      'assigned',
      'in_repair',
      'ordered',
      'retired',
      'lost_stolen',
    ]);
  });

  it('labels every status exactly as the design writes it', () => {
    expect(ASSET_STATUS_LABELS).toEqual({
      available: 'Available',
      assigned: 'Assigned',
      in_repair: 'In repair',
      ordered: 'Ordered',
      retired: 'Retired',
      lost_stolen: 'Lost/Stolen',
    });
  });

  it('maps every status to the semantic color the design uses', () => {
    expect(ASSET_STATUS_COLORS).toEqual({
      available: 'ok',
      assigned: 'acc',
      in_repair: 'warn',
      ordered: 'info',
      retired: 'neut',
      lost_stolen: 'err',
    });
  });

  it('only uses known semantic colors', () => {
    for (const color of Object.values(ASSET_STATUS_COLORS)) {
      expect(SEMANTIC_COLORS).toContain(color);
    }
  });
});

describe('the default workflow', () => {
  it('seeds exactly the six statuses the enum ships, in the same order', () => {
    expect(DEFAULT_ASSET_STATUSES.map((entry) => entry.id)).toEqual([...ASSET_STATUSES]);
  });

  it('carries today’s labels and colors entry for entry', () => {
    for (const entry of DEFAULT_ASSET_STATUSES) {
      expect(entry.label, entry.id).toBe(ASSET_STATUS_LABELS[entry.id]);
      expect(entry.color, entry.id).toBe(ASSET_STATUS_COLORS[entry.id]);
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

  it('offers the three check-in destinations the check-in modal offers today', () => {
    expect(
      DEFAULT_ASSET_STATUSES.filter((entry) => entry.checkinTarget).map((entry) => entry.id),
    ).toEqual([...CHECKIN_NEW_STATUSES]);
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

  it('offers the three new statuses with "Return to stock" wording for available', () => {
    expect(CHECKIN_NEW_STATUSES).toEqual(['available', 'in_repair', 'retired']);
    expect(CHECKIN_NEW_STATUS_LABELS).toEqual({
      available: 'Return to stock',
      in_repair: 'In repair',
      retired: 'Retired',
    });
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

describe('canDirectlyTransition', () => {
  it('allows moving between non-assigned statuses', () => {
    expect(canDirectlyTransition('available', 'retired')).toBe(true);
    expect(canDirectlyTransition('ordered', 'available')).toBe(true);
    expect(canDirectlyTransition('lost_stolen', 'available')).toBe(true);
  });

  it('never allows entering or leaving assigned directly (use assign/check-in)', () => {
    expect(canDirectlyTransition('available', 'assigned')).toBe(false);
    expect(canDirectlyTransition('assigned', 'available')).toBe(false);
  });

  it('rejects a no-op transition', () => {
    expect(canDirectlyTransition('retired', 'retired')).toBe(false);
  });
});
