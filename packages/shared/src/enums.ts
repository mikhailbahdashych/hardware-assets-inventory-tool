// Type-only, and deliberately circular with types/workflow.ts: the shape is
// declared there beside the rest of the wire vocabulary, and the seed table
// below is the one value that has to satisfy it. Both sides erase at build.
import type { WorkflowStatus } from './types/workflow.js';

// Single source of truth for every enum in the product, plus the label and
// semantic-color maps the design derives from them. Enum values are slugs;
// the database stores slugs with no CHECK constraints, so adding a value here
// (plus its labels/colors) is a code-only change — no migration.
//
// **Asset statuses are the exception, and no longer live here.** They are rows
// in `asset_statuses`, edited on the Workflow page: an admin adds, renames,
// recolors and reorders them, and the moves between them are a graph in a
// second table. What survives below is the seed — the workflow a fresh
// instance starts with, which is also the label map the audit renderer falls
// back to for events written before any of that existed.

/** Semantic color keys — rendered as `color:var(--{sv}); background:var(--{sv}-bg)`. */
export const SEMANTIC_COLORS = ['ok', 'acc', 'warn', 'err', 'info', 'neut'] as const;
export type SemanticColor = (typeof SEMANTIC_COLORS)[number];

/**
 * The colours named by the colour they are, for the two forms where a person
 * picks one — a status's pill and a role's. An admin choosing a colour is
 * choosing what it looks like; the `sv` key rides along as the option's
 * description, so the design system's own word for it is still on screen.
 */
export const SEMANTIC_COLOR_LABELS: Record<SemanticColor, string> = {
  ok: 'Green',
  acc: 'Purple',
  warn: 'Amber',
  err: 'Red',
  info: 'Blue',
  neut: 'Grey',
};

/**
 * The one status slug the code may reference by name. `assigned` is the system
 * status: only assign and check-in enter or leave it, which is what keeps
 * `assets.status = 'assigned'` ⇔ an open ownership row true.
 */
export const ASSIGNED_STATUS = 'assigned';

/** The matrix and the dashboard tiles have to stay readable. */
export const MAX_ASSET_STATUSES = 20;

/**
 * The workflow a fresh instance is seeded with, and the legacy label map the
 * audit renderer falls back to for events written before statuses became data.
 * Array order is the seeded `sort_order`; the flags reproduce exactly what the
 * assign and check-in code used to hard-code.
 */
export const DEFAULT_ASSET_STATUSES = [
  {
    id: 'available',
    label: 'Available',
    color: 'ok',
    isSystem: false,
    assignableFrom: true,
    checkinTarget: true,
  },
  {
    id: 'assigned',
    label: 'Assigned',
    color: 'acc',
    isSystem: true,
    assignableFrom: false,
    checkinTarget: false,
  },
  {
    id: 'in_repair',
    label: 'In repair',
    color: 'warn',
    isSystem: false,
    assignableFrom: false,
    checkinTarget: true,
  },
  {
    id: 'ordered',
    label: 'Ordered',
    color: 'info',
    isSystem: false,
    assignableFrom: true,
    checkinTarget: false,
  },
  {
    id: 'retired',
    label: 'Retired',
    color: 'neut',
    isSystem: false,
    assignableFrom: false,
    checkinTarget: true,
  },
  {
    id: 'lost_stolen',
    label: 'Lost/Stolen',
    color: 'err',
    isSystem: false,
    assignableFrom: false,
    checkinTarget: false,
  },
] as const satisfies readonly Omit<WorkflowStatus, 'sortOrder'>[];

export const ASSET_CATEGORIES = [
  'laptops',
  'desktops',
  'monitors',
  'phones',
  'peripherals',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  laptops: 'Laptops',
  desktops: 'Desktops',
  monitors: 'Monitors',
  phones: 'Phones',
  peripherals: 'Peripherals',
};

/** Department is free text on employees; these only seed the form select ("Other" enables custom input). */
export const DEPARTMENT_SUGGESTIONS = [
  'Engineering',
  'Design',
  'IT Operations',
  'Finance',
  'Sales',
  'Marketing',
  'Other',
] as const;

export const EMPLOYEE_STATUSES = ['active', 'offboarding'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  offboarding: 'Offboarding',
};
export const EMPLOYEE_STATUS_COLORS: Record<EmployeeStatus, SemanticColor> = {
  active: 'ok',
  offboarding: 'warn',
};

export const MEMBER_STATUSES = ['active', 'invited'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Active',
  invited: 'Invited',
};
export const MEMBER_STATUS_COLORS: Record<MemberStatus, SemanticColor> = {
  active: 'ok',
  invited: 'info',
};

// Roles were an enum here, ranked and labelled at compile time. They are rows
// in `roles` now, so what a workspace calls them and what each may do is
// nobody's build-time knowledge — see `DEFAULT_ROLES` in rbac.ts for the three
// a fresh instance is seeded with, and `ADMIN_ROLE` for the one id the code may
// still name.

export const CHECKIN_CONDITIONS = ['good', 'needs_repair', 'damaged'] as const;
export type CheckinCondition = (typeof CHECKIN_CONDITIONS)[number];
export const CHECKIN_CONDITION_LABELS: Record<CheckinCondition, string> = {
  good: 'Good',
  needs_repair: 'Needs repair',
  damaged: 'Damaged',
};

// Where a checked-in asset may land is not an enum either: it is the
// `checkin_target` flag on the workspace's own statuses, and the check-in
// modal offers whatever carries it.

/** Custom-field value types. The database stores every value as text. */
export const CUSTOM_FIELD_TYPES = ['text', 'boolean', 'date', 'number'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  boolean: 'Yes / No',
  date: 'Date',
  number: 'Number',
};

export const AUDIT_TYPES = ['assets', 'people', 'auth', 'system'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];
export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  assets: 'Assets',
  people: 'People',
  auth: 'Auth',
  system: 'System',
};
export const AUDIT_TYPE_COLORS: Record<AuditType, SemanticColor> = {
  assets: 'acc',
  people: 'info',
  auth: 'neut',
  system: 'warn',
};

/**
 * How far ahead of a warranty expiring the nightly scan mails admins — a
 * number of days the workspace chooses, not a menu of three.
 *
 * The bounds are what makes it a *lead* time: below a day there is no notice
 * to give (the dashboard already shows what expires today), and beyond a year
 * the alert arrives long before anyone can act on it.
 */
export const MIN_WARRANTY_LEAD_DAYS = 1;
export const MAX_WARRANTY_LEAD_DAYS = 365;

/** Activity-log retention in months; `null` is the design's "Forever". */
export const LOG_RETENTION_OPTIONS = [12, 24, null] as const;
export type LogRetention = (typeof LOG_RETENTION_OPTIONS)[number];
export const LOG_RETENTION_LABELS: Record<`${LogRetention}`, string> = {
  12: '12 months',
  24: '24 months',
  null: 'Forever',
};

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: 'EUR (€)',
  USD: 'USD ($)',
  GBP: 'GBP (£)',
  PLN: 'PLN (zł)',
};

export const ASSIGNMENT_OUTCOMES = ['returned', 'upgraded', 'in_repair', 'offboarded'] as const;
export type AssignmentOutcome = (typeof ASSIGNMENT_OUTCOMES)[number];
export const ASSIGNMENT_OUTCOME_LABELS: Record<AssignmentOutcome, string> = {
  returned: 'returned',
  upgraded: 'upgraded',
  in_repair: 'in repair',
  offboarded: 'offboarded',
};

// Which direct moves are legal is a graph in `asset_status_transitions` now,
// enforced by the workflow service. `assigned` appears in neither column of
// it: assign and check-in are its only doors, which is what keeps
// `assets.status = 'assigned'` ⇔ an open ownership row true.
