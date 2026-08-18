import type {
  AssetCategory,
  AssignmentOutcome,
  AuditType,
  CheckinCondition,
  Currency,
  CustomFieldType,
  EmployeeStatus,
  ImportKind,
  LogRetention,
  MemberStatus,
  Role,
  SemanticColor,
} from '@inventory/shared';
import type { Density, Theme } from './theme';

// Every shape the API sends back, named once. Nullable fields are nullable
// because the column is: `null` here is a real state, not a missing value.

/** What `apiFetch` accepts beyond the path. */
export interface ApiRequest {
  /** PUT is for the two workflow endpoints that replace a whole collection. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export interface Member {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'invited';
  employeeId: string | null;
  lastActiveAt: string | null;
  theme: Theme;
  density: Density;
  widgets: Record<string, boolean>;
  /** They hold a confirmed authenticator. The secret itself never leaves the API. */
  mfaEnrolled: boolean;
}

/**
 * Public instance metadata. `orgName` and `defaultCurrency` are absent only
 * while `needsSetup` is true — see `OrgMeta` for the signed-in view.
 */
export interface Meta {
  needsSetup: boolean;
  version: string;
  orgName?: string;
  /** Currency for assets that do not carry one of their own. */
  defaultCurrency?: Currency;
  /**
   * Whether this instance can send email at all. Not a secret — it says
   * nothing about where mail goes — and the UI needs it to stop offering
   * checkboxes nothing would act on.
   */
  smtpConfigured: boolean;
}

/**
 * `Meta` once setup has run. Both fields are NOT NULL columns written by the
 * setup flow, so inside the signed-in app they are always present.
 */
export interface OrgMeta {
  version: string;
  orgName: string;
  defaultCurrency: Currency;
}

export interface InviteDetails {
  email: string;
  role: Role;
  orgName: string;
}

/** Who holds an asset right now, read from its open ownership record. */
export interface CurrentHolder {
  employeeId: string | null;
  name: string;
  checkedOutAt: string;
  expectedReturnDate: string | null;
}

export interface Asset {
  id: string;
  assetTag: string;
  name: string;
  category: AssetCategory;
  /** A status id (`asset_statuses.id`) — a row an admin edits, not an enum. */
  status: string;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchasePriceCents: number | null;
  currency: Currency | null;
  supplier: string | null;
  warrantyUntil: string | null;
  notes: string | null;
  currentHolder: CurrentHolder | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  sortOrder: number;
}

/** One ownership record — the only truth about who has held an asset. */
export interface Assignment {
  id: string;
  employeeId: string | null;
  holderName: string;
  checkedOutAt: string;
  expectedReturnDate: string | null;
  returnedAt: string | null;
  outcome: AssignmentOutcome | null;
  checkoutNotes: string | null;
  checkinCondition: CheckinCondition | null;
  checkinNotes: string | null;
}

/** The same record seen from the person's side, so it names the asset. */
export interface Holding extends Assignment {
  assetId: string;
  assetName: string;
  assetTag: string;
  category: AssetCategory;
  serialNumber: string | null;
}

export interface Attachment {
  id: string;
  assetId: string;
  filename: string;
  sizeBytes: number;
  mime: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actorName: string;
  params: Record<string, unknown>;
}

export interface CustomFieldValue {
  key: string;
  label: string;
  type: CustomFieldType;
  value: string | null;
}

export interface AssetDetail {
  asset: Asset;
  customFields: CustomFieldValue[];
  history: Assignment[];
  attachments: Attachment[];
  auditTrail: AuditEntry[];
}

export interface EmployeeDetail {
  employee: Employee;
  holdings: Holding[];
  history: Holding[];
}

/**
 * A member as the Members page reads them — never the theme, density and
 * widget layout `Member` carries, which belong to the signed-in person alone.
 */
/**
 * The signed-in member plus the one thing about them that depends on workspace
 * policy: whether they owe an enrolment. A non-admin cannot read settings, so
 * the API answers it here rather than making the app work it out.
 */
export interface Session {
  member: Member;
  mustEnrolMfa: boolean;
}

/**
 * What a password gets you. Either a session, or — when the account has an
 * authenticator — a short-lived challenge to answer with a code.
 */
export type LoginResult = { member: Member } | { mfaRequired: true; challengeToken: string };

/** What enrolment hands the browser: something to scan, something to type. */
export interface MfaEnrolment {
  secret: string;
  otpauthUri: string;
}

export interface MemberSummary {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: MemberStatus;
  employeeId: string | null;
  /** The employee record for the same person, named so the list need not join. */
  linkedEmployee: { id: string; displayName: string } | null;
  lastActiveAt: string | null;
  createdAt: string;
  mfaEnrolled: boolean;
}

export interface OrgSettings {
  id: number;
  orgName: string;
  defaultCurrency: Currency;
  assetTagPrefix: string;
  /** Days of notice before a warranty expires; the workspace picks the number. */
  warrantyLeadDays: number;
  /** null is "Forever" — a choice, not an absence. */
  logRetentionMonths: LogRetention;
  emailWarrantyAlerts: boolean;
  emailReturnReminders: boolean;
  emailInvites: boolean;
  emailWeeklyDigest: boolean;
  /** Every member must hold a confirmed authenticator to use the workspace. */
  mfaRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One activity-log row. `AuditEntry` is the same event on an asset's own trail. */
export interface AuditLogItem extends AuditEntry {
  type: AuditType;
  assetId: string | null;
  employeeId: string | null;
  memberId: string | null;
}

export interface AuditPage {
  items: AuditLogItem[];
  /** How many events sit behind each filter pill, over the whole log. */
  typeCounts: Record<AuditType | 'all', number>;
  /** Events matching the current filter — what "Load more" counts against. */
  total: number;
}

export interface CategoryCount {
  category: AssetCategory;
  count: number;
}

/**
 * One KPI tile. It carries its own label and colour, so the dashboard draws
 * whatever statuses the workspace has, in the workspace's order, without a
 * vocabulary of its own to fall out of date. Mirrors the API's `StatusCount`.
 */
export interface StatusCount {
  id: string;
  label: string;
  color: SemanticColor;
  count: number;
}

/** A warranty running out soon; `daysLeft` picks the pill's urgency colour. */
export interface WarrantyExpiry {
  assetId: string;
  name: string;
  assetTag: string;
  warrantyUntil: string;
  daysLeft: number;
}

export interface PendingReturn {
  assetId: string;
  assetName: string;
  assetTag: string;
  employeeId: string | null;
  holderName: string;
  expectedReturnDate: string;
}

/** Five widgets, one request — see `useDashboard`. */
export interface DashboardPayload {
  assetCount: number;
  /** Every status in sort order, zeros included — a tile is drawn regardless. */
  statusCounts: StatusCount[];
  categoryCounts: CategoryCount[];
  recentActivity: AuditLogItem[];
  warrantyExpirations: WarrantyExpiry[];
  pendingReturns: PendingReturn[];
}

/** One thing wrong (or worth saying) about one cell of an imported file. */
export interface ImportIssue {
  /** 1-based including the header, so it matches what a spreadsheet shows. */
  row: number;
  column: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  validCount: number;
  createCount: number;
  updateCount: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** The lists are capped; the counts above are still exact. */
  errorsTruncated: boolean;
  warningsTruncated: boolean;
}

export interface ImportResult {
  kind: ImportKind;
  created: number;
  updated: number;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  employeeCode: string | null;
  startDate: string | null;
  status: EmployeeStatus;
  activeAssetCount: number;
  createdAt: string;
  updatedAt: string;
}
