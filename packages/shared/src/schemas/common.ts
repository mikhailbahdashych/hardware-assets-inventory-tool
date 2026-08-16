import { z } from 'zod';

// Field builders every entity schema shares. Two conventions live here:
// emails are lowercased at the boundary, and blank optional text is stored as
// NULL — so "" and "   " never reach a column.

export const email = z.email().transform((value) => value.toLowerCase());

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
  .refine((value) => value === '' || DATE_ONLY.test(value), 'Use the format YYYY-MM-DD')
  .transform((value) => (value === '' ? null : value))
  .nullable();
