import { ASSIGNED_STATUS, DEFAULT_ASSET_STATUSES } from '@inventory/shared';
import { assetStatuses, assetStatusTransitions, customFieldDefs } from './schema.js';
import type { Db } from '@/types/db.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';

const DEFAULT_CUSTOM_FIELDS = [
  { key: 'mdm_enrolled', label: 'MDM enrolled', type: 'boolean' },
  { key: 'disk_encryption', label: 'Disk encryption', type: 'boolean' },
  { key: 'hostname', label: 'Hostname', type: 'text' },
  { key: 'cost_center', label: 'Cost center', type: 'text' },
] as const;

/** Idempotent boot seed: default custom-field definitions and, on an instance
 *  that has none, the default workflow. Org settings are created by the
 *  first-run setup flow, and nothing here invents demo data — a fresh
 *  container starts empty on purpose. */
export function seed(db: Db): void {
  DEFAULT_CUSTOM_FIELDS.forEach((field, index) => {
    db.insert(customFieldDefs)
      .values({
        id: newId(),
        key: field.key,
        label: field.label,
        type: field.type,
        sortOrder: index,
        createdAt: nowIso(),
      })
      .onConflictDoNothing({ target: customFieldDefs.key })
      .run();
  });

  seedWorkflow(db);
}

/**
 * Today's behaviour, written down as data: the six statuses in enum order and
 * a full mesh between the five an asset may be moved to directly. `assigned`
 * gets no edges at all — assign and check-in are its only doors.
 *
 * Guarded on the table being empty rather than per row, unlike the custom
 * fields above: a workspace that has edited its workflow has *deleted* rows on
 * purpose, and putting them back at every boot would be the seed undoing an
 * admin's work.
 */
function seedWorkflow(db: Db): void {
  if (db.select({ id: assetStatuses.id }).from(assetStatuses).limit(1).get()) return;

  const at = nowIso();
  DEFAULT_ASSET_STATUSES.forEach((status, index) => {
    db.insert(assetStatuses)
      .values({
        id: status.id,
        label: status.label,
        color: status.color,
        isSystem: status.isSystem,
        assignableFrom: status.assignableFrom,
        checkinTarget: status.checkinTarget,
        sortOrder: index,
        createdAt: at,
        updatedAt: at,
      })
      .run();
  });

  const movable = DEFAULT_ASSET_STATUSES.filter((status) => status.id !== ASSIGNED_STATUS);
  for (const from of movable) {
    for (const to of movable) {
      if (from.id === to.id) continue;
      db.insert(assetStatusTransitions).values({ fromStatus: from.id, toStatus: to.id }).run();
    }
  }
}
