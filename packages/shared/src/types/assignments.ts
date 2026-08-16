import type { CheckinNewStatus, EmployeeStatus } from '../enums.js';

/**
 * Everything `deriveOutcome` needs to say why an ownership record ended.
 * `holderStatus` is null when the person who held the asset has since been
 * deleted — a real state, not a missing value.
 */
export interface OutcomeInput {
  holderStatus: EmployeeStatus | null;
  newStatus: CheckinNewStatus;
}
