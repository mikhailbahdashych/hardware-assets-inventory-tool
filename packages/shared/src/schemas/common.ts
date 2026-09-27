import { z } from 'zod';

// Field builders every entity schema shares. Two conventions live here:
// emails are lowercased at the boundary, and blank optional text is stored as
// NULL — so "" and "   " never reach a column.

export const email = z.email().transform((value) => value.toLowerCase());

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `DATE_ONLY` with its parts captured; that one stays bare, the manual prints it. */
const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_FORMAT = 'Use the format YYYY-MM-DD';
const NOT_A_DAY = 'That day is not on the calendar — check the month and the day.';

/**
 * A `YYYY-MM-DD` naming a day the calendar has. The shape alone let
 * `2026-13-45` through to a column, where the browser's formatter threw on it
 * for everybody. `Date.UTC` rolls an impossible day over (Feb 30 → Mar 2), so
 * a day that does not come back out as written was never a day.
 */
export function isCalendarDate(value: string): boolean {
  const parts = DATE_PARTS.exec(value);
  if (!parts) return false;
  // The regex matched, so all three of its groups did.
  const [year, month, day] = [Number(parts[1]!), Number(parts[2]!), Number(parts[3]!)];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * What is wrong with a date-only string, in the words the schemas use, or null
 * when it is a real day. For the values no schema types — a custom field's
 * type is a row, so its values arrive as plain strings and the service checks.
 */
export function dateProblem(value: string): string | null {
  if (!DATE_ONLY.test(value)) return DATE_FORMAT;
  return isCalendarDate(value) ? null : NOT_A_DAY;
}

/** Shape first, then the calendar — one message each, never both at once. */
const isDayIfShaped = (value: string) => !DATE_ONLY.test(value) || isCalendarDate(value);

/** A date-only value that must be there ("YYYY-MM-DD", and a real day). */
export const requiredDate = z
  .string()
  .regex(DATE_ONLY, DATE_FORMAT)
  .refine(isDayIfShaped, NOT_A_DAY);

/** Trimmed free text, blank-as-NULL. Pair with `.default(null)` on creates. */
export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

/** A date-only value ("YYYY-MM-DD"), blank-as-NULL. Never a timestamp. */
export const nullableDate = z
  .string()
  .trim()
  .refine((value) => value === '' || DATE_ONLY.test(value), DATE_FORMAT)
  .refine((value) => value === '' || isDayIfShaped(value), NOT_A_DAY)
  .transform((value) => (value === '' ? null : value))
  .nullable();
