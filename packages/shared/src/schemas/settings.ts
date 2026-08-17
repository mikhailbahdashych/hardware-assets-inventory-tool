import { z } from 'zod';
import { CURRENCIES, LOG_RETENTION_OPTIONS, WARRANTY_LEAD_DAY_OPTIONS } from '../enums.js';

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
  warrantyLeadDays: z.union(WARRANTY_LEAD_DAY_OPTIONS.map((days) => z.literal(days))).optional(),
  logRetentionMonths: z.union(LOG_RETENTION_OPTIONS.map((months) => z.literal(months))).optional(),
  emailWarrantyAlerts: z.boolean().optional(),
  emailReturnReminders: z.boolean().optional(),
  emailInvites: z.boolean().optional(),
  emailWeeklyDigest: z.boolean().optional(),
});
export type SettingsPatchInput = z.infer<typeof settingsPatchInput>;
