import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { ASSIGNED_STATUS, type AssetCreateInput, type AssetPatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Db, DbOrTx } from '@/types/db.js';
import {
  assetCustomValues,
  assets,
  assignments,
  auditEvents,
  customFieldDefs,
  employees,
  orgSettings,
} from '@/db/schema.js';
import { AppError, invalidFields, notFound } from '@/lib/errors.js';
import { nowIso, todayDate } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { serializeAsset, serializeAssignment } from '@/lib/serialize.js';
import type { Actor } from '@/types/audit.js';
import type { StatusMove } from '@/types/assets.js';
import { writeAudit } from './audit.js';
import { activeAssignment, assetHistory, openAssignment } from './assignments.js';
import { listAttachments, storedNamesForAsset } from './attachments.js';
import { computeNextTag } from './tag.js';
import { requireStatus, transitionAllowed } from './workflow.js';

export type AssetRow = typeof assets.$inferSelect;

/** Columns a plain edit may touch. Status has its own rules; holders have none. */
const EDITABLE = [
  'name',
  'category',
  'assetTag',
  'model',
  'serialNumber',
  'purchaseDate',
  'purchasePriceCents',
  'currency',
  'supplier',
  'warrantyUntil',
  'notes',
] as const;

/** Newest first: the asset you just registered is the one you want to see. */
export function listAssets(db: Db) {
  return db
    .select({ asset: assets, holder: assignments })
    .from(assets)
    .leftJoin(assignments, and(eq(assignments.assetId, assets.id), isNull(assignments.returnedAt)))
    .orderBy(desc(assets.createdAt))
    .all()
    .map((row) => serializeAsset(row.asset, row.holder));
}

export function getAssetDetail(db: Db, id: string) {
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) throw notFound('That asset');

  const values = new Map(
    db
      .select()
      .from(assetCustomValues)
      .where(eq(assetCustomValues.assetId, id))
      .all()
      .map((row) => [row.fieldDefId, row.value]),
  );
  const customFields = db
    .select()
    .from(customFieldDefs)
    .orderBy(customFieldDefs.sortOrder)
    .all()
    .map((def) => ({
      key: def.key,
      label: def.label,
      type: def.type,
      // Every definition is listed for every asset; no row for this pair
      // means the field is genuinely unset on this asset.
      value: values.get(def.id) ?? null,
    }));

  // The last 20 events about this asset; the full log lives under Admin.
  const auditTrail = db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.assetId, id))
    .orderBy(desc(auditEvents.at))
    .limit(20)
    .all()
    .map((event) => ({
      id: event.id,
      at: event.at,
      action: event.action,
      actorName: event.actorName,
      params: JSON.parse(event.params) as Record<string, unknown>,
    }));

  return {
    asset: serializeAsset(asset, activeAssignment(db, id)),
    customFields,
    history: assetHistory(db, id).map(serializeAssignment),
    attachments: listAttachments(db, id),
    auditTrail,
  };
}

/**
 * The suggestion the New-asset form prefills; the field stays editable.
 *
 * The prefix comes from org settings and nowhere else. Every caller is behind
 * a session, and a session implies the instance was set up, so a missing
 * settings row is a broken invariant — better to say so than to quietly
 * generate tags under a second, invented prefix nobody chose.
 */
export function nextAssetTag(db: DbOrTx): string {
  const settings = db.select().from(orgSettings).get();
  if (!settings) {
    throw new AppError(
      500,
      'not_initialized',
      'This instance has no organization settings, so asset tags cannot be numbered.',
    );
  }
  const tags = db
    .select({ assetTag: assets.assetTag })
    .from(assets)
    .all()
    .map((row) => row.assetTag);
  return computeNextTag(settings.assetTagPrefix, tags);
}

export function createAsset(deps: AppDeps, actor: Actor, input: AssetCreateInput) {
  const now = deps.now();
  const at = nowIso(now);

  return deps.db.transaction((tx) => {
    // The form may leave the tag out entirely, which means "number it for me".
    const assetTag = input.assetTag ?? nextAssetTag(tx);
    if (tx.select().from(assets).where(eq(assets.assetTag, assetTag)).get()) {
      throw invalidFields({ assetTag: 'That asset tag is already in use.' });
    }

    // Registering an asset is not a transition — any status the workspace has
    // is a legal starting point, which is also what keeps the CSV import
    // insert-only. It just has to be a status that exists.
    requireStatus(tx, input.status);

    let holder: typeof employees.$inferSelect | null = null;
    if (input.status === ASSIGNED_STATUS) {
      const found = tx
        .select()
        .from(employees)
        .where(eq(employees.id, input.assignedToEmployeeId!))
        .get();
      if (!found) {
        throw invalidFields({ assignedToEmployeeId: 'That employee could not be found.' });
      }
      holder = found;
    }

    const id = newId();
    tx.insert(assets)
      .values({
        id,
        assetTag,
        name: input.name,
        category: input.category,
        status: input.status,
        model: input.model,
        serialNumber: input.serialNumber,
        purchaseDate: input.purchaseDate,
        purchasePriceCents: input.purchasePriceCents,
        currency: input.currency,
        supplier: input.supplier,
        warrantyUntil: input.warrantyUntil,
        notes: input.notes,
        createdAt: at,
        updatedAt: at,
      })
      .run();

    applyCustomValues(tx, id, input.customValues);
    writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.created',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        assetId: id,
        params: { assetName: input.name, assetTag },
      },
      now,
    );

    if (holder) {
      const holderName = `${holder.firstName} ${holder.lastName}`;
      openAssignment(
        tx,
        {
          assetId: id,
          employeeId: holder.id,
          holderName,
          // The create form makes the checkout date optional; leaving it out
          // means "handed over today", which is what this records.
          checkedOutAt: input.checkoutDate ?? todayDate(now),
        },
        now,
      );
      writeAudit(
        tx,
        {
          type: 'assets',
          action: 'asset.assigned',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          assetId: id,
          employeeId: holder.id,
          params: { assetName: input.name, assetTag, holderName },
        },
        now,
      );
    }

    return serializeAsset(
      tx.select().from(assets).where(eq(assets.id, id)).get()!,
      activeAssignment(tx, id),
    );
  });
}

export function updateAsset(deps: AppDeps, actor: Actor, id: string, patch: AssetPatchInput) {
  const now = deps.now();

  return deps.db.transaction((tx) => {
    const current = tx.select().from(assets).where(eq(assets.id, id)).get();
    if (!current) throw notFound('That asset');

    const values: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const field of EDITABLE) {
      // Patch semantics (see packages/shared/CLAUDE.md): absent means "leave
      // alone" — already skipped — so a present field that carries no value
      // means "clear it", and NULL is how the column says that.
      if (!(field in patch)) continue;
      const next = patch[field] ?? null;
      if (next === current[field]) continue;
      values[field] = next;
      changedFields.push(field);
    }

    if (typeof values.assetTag === 'string') {
      const clash = tx
        .select()
        .from(assets)
        .where(and(eq(assets.assetTag, values.assetTag), ne(assets.id, id)))
        .get();
      if (clash) throw invalidFields({ assetTag: 'That asset tag is already in use.' });
    }

    let statusMove: StatusMove | null = null;
    if (patch.status && patch.status !== current.status) {
      const to = requireStatus(tx, patch.status);
      // The status the asset is leaving. A slug with no row would be a broken
      // invariant — a deleted status takes its assets somewhere — so the same
      // 422 says which one, rather than letting the move proceed unchecked.
      const from = requireStatus(tx, current.status);

      // Moving in or out of `assigned` is what assign and check-in are for.
      if (from.isSystem || to.isSystem) {
        throw new AppError(
          409,
          'status_locked',
          'Assign or check the asset in to change who holds it.',
        );
      }
      if (!transitionAllowed(tx, from.id, to.id)) {
        throw new AppError(
          409,
          'transition_not_allowed',
          `The workflow does not allow ${from.label} → ${to.label}.`,
        );
      }

      values.status = to.id;
      statusMove = { from: from.id, to: to.id };
    }

    changedFields.push(...applyCustomValues(tx, id, patch.customValues));
    if (changedFields.length === 0 && !statusMove) {
      return serializeAsset(current, activeAssignment(tx, id));
    }

    values.updatedAt = nowIso(now);
    tx.update(assets).set(values).where(eq(assets.id, id)).run();

    // The audit line names the asset as it is *after* the edit, so an unchanged
    // field reads from the stored row rather than from the patch.
    const subject = {
      assetName: (values.name as string | undefined) ?? current.name,
      assetTag: (values.assetTag as string | undefined) ?? current.assetTag,
    };
    if (changedFields.length > 0) {
      writeAudit(
        tx,
        {
          type: 'assets',
          action: 'asset.updated',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          assetId: id,
          params: { ...subject, changedFields },
        },
        now,
      );
    }
    if (statusMove) {
      writeAudit(
        tx,
        {
          type: 'assets',
          action: 'asset.status_changed',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          assetId: id,
          params: { ...subject, ...statusMove },
        },
        now,
      );
    }

    return serializeAsset(
      tx.select().from(assets).where(eq(assets.id, id)).get()!,
      activeAssignment(tx, id),
    );
  });
}

/** Returns the stored file names the caller should unlink once the rows are gone. */
export function deleteAsset(deps: AppDeps, actor: Actor, id: string): string[] {
  const now = deps.now();
  const storedNames = storedNamesForAsset(deps.db, id);

  deps.db.transaction((tx) => {
    const asset = tx.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw notFound('That asset');
    if (activeAssignment(tx, id)) {
      throw new AppError(
        409,
        'asset_assigned',
        'Check this asset in before deleting it — somebody still holds it.',
      );
    }

    // Custom values, attachments and past ownership records cascade away.
    tx.delete(assets).where(eq(assets.id, id)).run();
    writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.deleted',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        params: { assetName: asset.name, assetTag: asset.assetTag },
      },
      now,
    );
  });

  return storedNames;
}

/** Writes the custom-field values in a payload; returns the keys that moved. */
function applyCustomValues(
  tx: DbOrTx,
  assetId: string,
  values: Record<string, string | null> | undefined,
): string[] {
  if (!values) return [];

  const defs = new Map(
    tx
      .select()
      .from(customFieldDefs)
      .all()
      .map((def) => [def.key, def]),
  );
  const changed: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const def = defs.get(key);
    if (!def) throw invalidFields({ [`customValues.${key}`]: 'That custom field does not exist.' });

    const where = and(
      eq(assetCustomValues.assetId, assetId),
      eq(assetCustomValues.fieldDefId, def.id),
    );
    // No row for this pair means the field is unset, which is the same state
    // an explicit null asks for — so neither is a change worth auditing.
    const existing = tx.select().from(assetCustomValues).where(where).get();
    if ((existing?.value ?? null) === value) continue;

    if (value === null) {
      tx.delete(assetCustomValues).where(where).run();
    } else {
      tx.insert(assetCustomValues)
        .values({ assetId, fieldDefId: def.id, value })
        .onConflictDoUpdate({
          target: [assetCustomValues.assetId, assetCustomValues.fieldDefId],
          set: { value },
        })
        .run();
    }
    changed.push(`custom.${key}`);
  }

  return changed;
}
