import type { AssetCategory, CheckinCondition, EmployeeStatus, Role } from '@inventory/shared';
import { DEFAULT_ASSET_STATUSES, ASSIGNED_STATUS } from '@inventory/shared';

// The demo dataset is written against the workflow a fresh instance is seeded
// with, so its two status vocabularies are derived from that list rather than
// from the workspace's rows — which do not exist yet when the file is read.
// (They stay with the value they come from, per the types convention.)

/** A status the dataset may give an asset directly. */
export type DemoStatus = Exclude<
  (typeof DEFAULT_ASSET_STATUSES)[number]['id'],
  typeof ASSIGNED_STATUS
>;

/** A status a checked-in asset may land in: the seeded check-in targets. */
export type DemoCheckinStatus = Extract<
  (typeof DEFAULT_ASSET_STATUSES)[number],
  { checkinTarget: true }
>['id'];

/** What `seedDemo` needs to know. */
export interface DemoSeedOptions {
  /** Shared by every active demo account, so the banner can print one line. */
  password: string;
  /**
   * Empty the workspace first. Without it a workspace that already holds
   * anything is refused, so the seeder can never be the thing that ate a real
   * inventory.
   */
  reset?: boolean;
}

/** One demo login, as printed for whoever is about to try the app. */
export interface DemoAccount {
  email: string;
  password: string;
  role: Role;
  displayName: string;
}

/** What the seed produced, for the summary and for the tests to assert on. */
export interface DemoCounts {
  members: number;
  employees: number;
  assets: number;
  assignments: number;
  auditEvents: number;
}

export interface DemoSeedResult {
  orgName: string;
  signIn: DemoAccount[];
  counts: DemoCounts;
}

/**
 * A person in the demo company. `daysAgo` is when they were added — every date
 * in the dataset is an offset from the seeding clock, so the demo is as current
 * as the moment it was run rather than slowly rotting toward a fixed date.
 */
export interface DemoPerson {
  key: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  location: string;
  startYearsAgo: number;
  addedDaysAgo: number;
  status: EmployeeStatus;
  /** Set when this person also signs in; the member row links to them. */
  account?: { role: Role; status: 'active' | 'invited' };
}

/** A device in the demo inventory, before any assignment has touched it. */
export interface DemoAsset {
  key: string;
  name: string;
  category: AssetCategory;
  model: string;
  serialNumber: string;
  priceEuros: number;
  supplier: string;
  purchasedDaysAgo: number;
  /** Days from now until the warranty lapses; negative is already expired. */
  warrantyInDays: number | null;
  addedDaysAgo: number;
  /**
   * Where the asset ends up. `assigned` is not set here — it is the consequence
   * of an open ownership record, which is the invariant this dataset exists to
   * demonstrate rather than contradict.
   */
  status: DemoStatus;
  custom?: { hostname?: string; costCenter?: string; mdm?: boolean; encrypted?: boolean };
}

/** One leg of an asset's ownership history, closed or still open. */
export interface DemoHolding {
  assetKey: string;
  personKey: string;
  fromDaysAgo: number;
  /** Absent for the holding that is still open. */
  untilDaysAgo?: number;
  /** Only meaningful while open — what the Pending returns widget reads. */
  dueInDays?: number;
  condition?: CheckinCondition;
  /**
   * Where the asset lands at check-in. Only three statuses are reachable that
   * way — `ordered` and `lost_stolen` are not things a return can produce.
   */
  returnedTo?: DemoCheckinStatus;
  notes?: string;
}
