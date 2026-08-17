import type {
  AssetCategory,
  AssetStatus,
  AssignmentOutcome,
  CheckinCondition,
  Currency,
  CustomFieldType,
  EmployeeStatus,
  Role,
} from '@inventory/shared';
import type { Density, Theme } from './theme';

// Every shape the API sends back, named once. Nullable fields are nullable
// because the column is: `null` here is a real state, not a missing value.

/** What `apiFetch` accepts beyond the path. */
export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
  status: AssetStatus;
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
