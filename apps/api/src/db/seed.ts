import { ASSIGNED_STATUS, DEFAULT_ASSET_STATUSES, DEFAULT_ROLES } from '@inventory/shared';
import {
  assetStatuses,
  assetStatusTransitions,
  customFieldDefs,
  rolePermissions,
  roles,
} from './schema.js';
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
 *  that has none, the default workflow and the default roles. Org settings are
 *  created by the first-run setup flow, and nothing here invents demo data — a
 *  fresh container starts empty on purpose. */
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
  seedRoles(db);
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

/**
 * Today's permissions, written down as data: the three roles an upgraded
 * instance already names in `members.role`, with Manager granted exactly what
 * the role ranking allowed. Admin gets no rows at all — the system role's set
 * is `ACTIONS`, resolved rather than stored, which is what makes an action
 * added in a future version its own without a boot-time reconciliation.
 *
 * Guarded on the table being empty, for the same reason the workflow above is:
 * an admin who deleted a role deleted it on purpose.
 */
function seedRoles(db: Db): void {
  if (db.select({ id: roles.id }).from(roles).limit(1).get()) return;

  const at = nowIso();
  DEFAULT_ROLES.forEach((role, index) => {
    db.insert(roles)
      .values({
        id: role.id,
        label: role.label,
        description: role.description,
        color: role.color,
        isSystem: role.isSystem,
        sortOrder: index,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    for (const action of role.grants) {
      db.insert(rolePermissions).values({ roleId: role.id, action }).run();
    }
  });
}
