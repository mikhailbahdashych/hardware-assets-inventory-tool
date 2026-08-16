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
import type { Density, Theme } from '@/providers/ThemeProvider';

export type Member = {
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
};

export type Meta = {
  needsSetup: boolean;
  version: string;
  orgName?: string;
  /** Currency for assets that do not carry one of their own. */
  defaultCurrency?: Currency;
};

export type InviteDetails = {
  email: string;
  role: Role;
  orgName: string;
};

/** Who holds an asset right now, read from its open ownership record. */
export type CurrentHolder = {
  employeeId: string | null;
  name: string;
  checkedOutAt: string;
  expectedReturnDate: string | null;
};

export type Asset = {
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
};

export type CustomFieldDef = {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  sortOrder: number;
};

/** One ownership record — the only truth about who has held an asset. */
export type Assignment = {
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
};

/** The same record seen from the person's side, so it names the asset. */
export type Holding = Assignment & {
  assetId: string;
  assetName: string;
  assetTag: string;
  category: AssetCategory;
  serialNumber: string | null;
};

export type Attachment = {
  id: string;
  assetId: string;
  filename: string;
  sizeBytes: number;
  mime: string | null;
  uploadedByName: string | null;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  actorName: string;
  params: Record<string, unknown>;
};

export type CustomFieldValue = {
  key: string;
  label: string;
  type: CustomFieldType;
  value: string | null;
};

export type AssetDetail = {
  asset: Asset;
  customFields: CustomFieldValue[];
  history: Assignment[];
  attachments: Attachment[];
  auditTrail: AuditEntry[];
};

export type EmployeeDetail = {
  employee: Employee;
  holdings: Holding[];
  history: Holding[];
};

export type Employee = {
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
};
