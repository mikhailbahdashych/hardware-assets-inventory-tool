import type { assignments } from '@/db/schema.js';

/**
 * One ownership record: who held an asset, from when, and — once it is closed —
 * until when and in what state it came back. This table is the only truth about
 * who holds what; there is no holder column on the asset.
 */
export type AssignmentRow = typeof assignments.$inferSelect;

/**
 * Handing an asset out. Only `openAssignment` may consume this — it is the one
 * code path allowed to pair `status = 'assigned'` with a new ownership row.
 */
export interface OpenAssignmentParams {
  assetId: string;
  employeeId: string;
  holderName: string;
  checkedOutAt: string;
  /** Nullable columns: null is a real state ("no date agreed", "no notes"). */
  expectedReturnDate?: string | null;
  notes?: string | null;
}

/** Taking an asset back — the mirror image of {@link OpenAssignmentParams}. */
export interface CloseAssignmentParams {
  /** The open ownership row being closed. */
  assignment: AssignmentRow;
  returnedAt: string;
  newStatus: string;
  condition?: string | null;
  notes?: string | null;
  outcome: string;
}

/** Enough of a holder to send them a message about what they are holding. */
export interface HolderContact {
  email: string;
  name: string;
}
