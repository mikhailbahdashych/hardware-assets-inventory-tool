import { z } from 'zod';
import {
  CURRENCIES,
  LOG_RETENTION_OPTIONS,
  MAX_WARRANTY_LEAD_DAYS,
  MIN_WARRANTY_LEAD_DAYS,
} from '../enums.js';

// The Admin → Settings card, one optional field per input. Absent means "leave
// alone"; `logRetentionMonths: null` is a value ("Forever"), not an absence.

export const settingsPatchInput = z.object({
  orgName: z.string().trim().min(1).max(120).optional(),
  defaultCurrency: z.enum(CURRENCIES).optional(),
  /**
   * Uppercased and letters/digits only: it becomes the literal head of every
   * generated tag ("AST-0224"), and a case-varying prefix would let AST-0224
   * and ast-0224 both exist while `computeNextTag` only ever sees one of them.
   */
  assetTagPrefix: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9]+$/, 'Use letters and digits only')
    .transform((value) => value.toUpperCase())
    .optional(),
  /** Whole days, so "45" is a workspace's answer as readily as 30, 60 or 90. */
  warrantyLeadDays: z
    .number()
    .int('Use a whole number of days.')
    .min(MIN_WARRANTY_LEAD_DAYS, `At least ${MIN_WARRANTY_LEAD_DAYS} day of notice.`)
    .max(MAX_WARRANTY_LEAD_DAYS, `At most ${MAX_WARRANTY_LEAD_DAYS} days of notice.`)
    .optional(),
  logRetentionMonths: z.union(LOG_RETENTION_OPTIONS.map((months) => z.literal(months))).optional(),
  emailWarrantyAlerts: z.boolean().optional(),
  emailReturnReminders: z.boolean().optional(),
  emailInvites: z.boolean().optional(),
  emailWeeklyDigest: z.boolean().optional(),
  /**
   * Turning this on makes every member enrol before they can use the app;
   * turning it off deletes every stored secret and recovery code, because a
   * disabled second factor that quietly kept its secrets is a lie.
   */
  mfaRequired: z.boolean().optional(),
});
export type SettingsPatchInput = z.infer<typeof settingsPatchInput>;
