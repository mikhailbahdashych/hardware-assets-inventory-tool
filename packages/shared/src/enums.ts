// Single source of truth for every enum in the product, plus the label and
// semantic-color maps the design derives from them. Enum values are slugs;
// the database stores slugs with no CHECK constraints, so adding a value here
// (plus its labels/colors) is a code-only change — no migration.

/** Semantic color keys — rendered as `color:var(--{sv}); background:var(--{sv}-bg)`. */
export const SEMANTIC_COLORS = ['ok', 'acc', 'warn', 'err', 'info', 'neut'] as const;
export type SemanticColor = (typeof SEMANTIC_COLORS)[number];

export const ASSET_STATUSES = [
  'available',
  'assigned',
  'in_repair',
  'ordered',
  'retired',
  'lost_stolen',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: 'Available',
  assigned: 'Assigned',
  in_repair: 'In repair',
  ordered: 'Ordered',
  retired: 'Retired',
  lost_stolen: 'Lost/Stolen',
};

export const ASSET_STATUS_COLORS: Record<AssetStatus, SemanticColor> = {
  available: 'ok',
  assigned: 'acc',
  in_repair: 'warn',
  ordered: 'info',
  retired: 'neut',
  lost_stolen: 'err',
};

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

export const ROLES = ['admin', 'manager', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
};
export const ROLE_COLORS: Record<Role, SemanticColor> = {
  admin: 'acc',
  manager: 'info',
  viewer: 'neut',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full access — settings, members, activity log',
  manager: 'Create and edit assets, employees and assignments',
  viewer: 'Read-only access to all pages',
};

export const CHECKIN_CONDITIONS = ['good', 'needs_repair', 'damaged'] as const;
export type CheckinCondition = (typeof CHECKIN_CONDITIONS)[number];
export const CHECKIN_CONDITION_LABELS: Record<CheckinCondition, string> = {
  good: 'Good',
  needs_repair: 'Needs repair',
  damaged: 'Damaged',
};

/** Statuses a checked-in asset can land in; "available" reads "Return to stock" in the check-in modal. */
export const CHECKIN_NEW_STATUSES = ['available', 'in_repair', 'retired'] as const;
export type CheckinNewStatus = (typeof CHECKIN_NEW_STATUSES)[number];
export const CHECKIN_NEW_STATUS_LABELS: Record<CheckinNewStatus, string> = {
  available: 'Return to stock',
  in_repair: 'In repair',
  retired: 'Retired',
};

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

/**
 * Whether the Change-status modal may move an asset from one status to another.
 * "assigned" is never entered or left directly — that is what assign/check-in are for.
 */
export function canDirectlyTransition(from: AssetStatus, to: AssetStatus): boolean {
  return from !== 'assigned' && to !== 'assigned' && from !== to;
}
