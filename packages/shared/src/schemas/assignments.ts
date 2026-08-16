import { z } from 'zod';
import { CHECKIN_CONDITIONS, CHECKIN_NEW_STATUSES, type AssignmentOutcome } from '../enums.js';
import type { OutcomeInput } from '../types/assignments.js';
import { nullableDate, nullableText } from './common.js';

// The three ways an asset changes hands or state. Assign and check-in are the
// only operations that may create or close an ownership record; everything
// else about an asset is an edit.

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const assignInput = z
  .object({
    employeeId: z.string().min(1),
    checkoutDate: requiredDate,
    expectedReturnDate: nullableDate.default(null),
    notes: nullableText(1000).default(null),
  })
  .refine((input) => !input.expectedReturnDate || input.expectedReturnDate >= input.checkoutDate, {
    message: 'The return date cannot precede the checkout.',
    path: ['expectedReturnDate'],
  });
export type AssignInput = z.infer<typeof assignInput>;

/** A returned asset lands in stock, in repair, or retired — never assigned. */
export const checkinInput = z.object({
  returnDate: requiredDate,
  newStatus: z.enum(CHECKIN_NEW_STATUSES),
  condition: z.enum(CHECKIN_CONDITIONS).nullable().default(null),
  notes: nullableText(1000).default(null),
});
export type CheckinInput = z.infer<typeof checkinInput>;

/**
 * Why an ownership record ended, derived rather than asked for — the person
 * checking an asset in already told us everything needed.
 *
 * Offboarding is checked first: "offboarded" explains the return better than
 * where the device happened to land. `upgraded` exists in the vocabulary for
 * history imported from elsewhere; nothing derives it yet.
 */
export function deriveOutcome(input: OutcomeInput): AssignmentOutcome {
  if (input.holderStatus === 'offboarding') return 'offboarded';
  if (input.newStatus === 'in_repair') return 'in_repair';
  return 'returned';
}
