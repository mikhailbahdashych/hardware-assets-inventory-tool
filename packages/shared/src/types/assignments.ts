import type { EmployeeStatus } from '../enums.js';

/**
 * Everything `deriveOutcome` needs to say why an ownership record ended.
 * `holderStatus` is null when the person who held the asset has since been
 * deleted — a real state, not a missing value. `newStatus` is a slug rather
 * than a union because the workspace chooses its own check-in destinations.
 */
export interface OutcomeInput {
  holderStatus: EmployeeStatus | null;
  newStatus: string;
}
