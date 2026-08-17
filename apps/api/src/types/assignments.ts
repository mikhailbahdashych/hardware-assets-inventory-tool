import type { assignments } from '@/db/schema.js';

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
  assignment: typeof assignments.$inferSelect;
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
