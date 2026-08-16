import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import {
  canDirectlyTransition,
  type AssetCreateInput,
  type AssetPatchInput,
  type AssetStatus,
} from '@inventory/shared';
import type { AppDeps } from '@/app.js';
import type { Db, DbOrTx } from '@/db/client.js';
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
import { serializeAsset, serializeAssignment, type Actor } from '@/lib/serialize.js';
import { writeAudit } from './audit.js';
import { activeAssignment, assetHistory, openAssignment } from './assignments.js';
import { listAttachments, storedNamesForAsset } from './attachments.js';
import { computeNextTag } from './tag.js';

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
    asset: serializeAsset(asset, activeAssignment(db, id) ?? null),
    customFields,
    history: assetHistory(db, id).map(serializeAssignment),
    attachments: listAttachments(db, id),
    auditTrail,
  };
}

/** The suggestion the New-asset form prefills; the field stays editable. */
export function nextAssetTag(db: DbOrTx): string {
  const settings = db.select().from(orgSettings).get();
  const tags = db
    .select({ assetTag: assets.assetTag })
    .from(assets)
    .all()
    .map((row) => row.assetTag);
  return computeNextTag(settings?.assetTagPrefix ?? 'AST', tags);
}

export function createAsset(deps: AppDeps, actor: Actor, input: AssetCreateInput) {
  const now = deps.now();
  const at = nowIso(now);

  return deps.db.transaction((tx) => {
    const assetTag = input.assetTag ?? nextAssetTag(tx);
    if (tx.select().from(assets).where(eq(assets.assetTag, assetTag)).get()) {
      throw invalidFields({ assetTag: 'That asset tag is already in use.' });
    }

    let holder: typeof employees.$inferSelect | null = null;
    if (input.status === 'assigned') {
      holder =
        tx.select().from(employees).where(eq(employees.id, input.assignedToEmployeeId!)).get() ??
        null;
      if (!holder) {
        throw invalidFields({ assignedToEmployeeId: 'That employee could not be found.' });
      }
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
      activeAssignment(tx, id) ?? null,
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

    // Moving in or out of `assigned` is what assign and check-in are for.
    let statusMove: { from: string; to: string } | null = null;
    if (patch.status && patch.status !== current.status) {
      if (!canDirectlyTransition(current.status as AssetStatus, patch.status)) {
        throw new AppError(
          409,
          'status_locked',
          'Assign or check the asset in to change who holds it.',
        );
      }
      values.status = patch.status;
      statusMove = { from: current.status, to: patch.status };
    }

    changedFields.push(...applyCustomValues(tx, id, patch.customValues));
    if (changedFields.length === 0 && !statusMove) {
      return serializeAsset(current, activeAssignment(tx, id) ?? null);
    }

    values.updatedAt = nowIso(now);
    tx.update(assets).set(values).where(eq(assets.id, id)).run();

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
      activeAssignment(tx, id) ?? null,
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
