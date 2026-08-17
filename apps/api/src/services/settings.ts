import { eq } from 'drizzle-orm';
import type { SettingsPatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Actor } from '@/types/audit.js';
import type { DbOrTx } from '@/types/db.js';
import type { OrgSettingsRow } from '@/types/settings.js';
import { orgSettings } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { AppError } from '@/lib/errors.js';
import { writeAudit } from './audit.js';

/** In the order the Settings page draws them, which is the order the audit reads. */
const EDITABLE = [
  'orgName',
  'defaultCurrency',
  'assetTagPrefix',
  'warrantyLeadDays',
  'logRetentionMonths',
  'emailWarrantyAlerts',
  'emailReturnReminders',
  'emailInvites',
  'emailWeeklyDigest',
] as const;

/**
 * The settings row exists from the moment setup runs, and every caller here is
 * behind an admin session — so a missing row is a broken instance, not a case
 * to paper over with defaults nobody chose.
 */
export function getSettings(db: DbOrTx): OrgSettingsRow {
  const settings = db.select().from(orgSettings).get();
  if (!settings) {
    throw new AppError(
      500,
      'not_initialized',
      'This instance has no organization settings, so there is nothing to configure.',
    );
  }
  return settings;
}

export function updateSettings(
  deps: AppDeps,
  actor: Actor,
  patch: SettingsPatchInput,
): OrgSettingsRow {
  const now = deps.now();

  return deps.db.transaction((tx) => {
    const current = getSettings(tx);

    const values: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const field of EDITABLE) {
      // Absent means "leave alone". `logRetentionMonths: null` is the design's
      // "Forever", which is why absence and null have to stay distinguishable.
      if (patch[field] === undefined) continue;
      if (patch[field] === current[field]) continue;
      values[field] = patch[field];
      changedFields.push(field);
    }
    if (changedFields.length === 0) return current;

    values.updatedAt = nowIso(now);
    tx.update(orgSettings).set(values).where(eq(orgSettings.id, current.id)).run();
    writeAudit(
      tx,
      {
        type: 'system',
        action: 'system.settings_updated',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { changedFields },
      },
      now,
    );

    return getSettings(tx);
  });
}
