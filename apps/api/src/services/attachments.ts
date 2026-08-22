import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { eq, sql } from 'drizzle-orm';
import { isAllowedAttachment } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import type { Db, DbOrTx } from '@/types/db.js';
import { assets, attachments, members } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { AppError, notFound } from '@/lib/errors.js';
import type { Actor } from '@/types/audit.js';
import type { UploadedFile } from '@/types/attachments.js';
import { writeAudit } from './audit.js';
import { getSettings } from './settings.js';

export type AttachmentRow = typeof attachments.$inferSelect;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const BYTES_PER_MB = 1024 * 1024;

/** Files live beside the database on the one volume a self-host has to back up. */
export const uploadsDir = (deps: AppDeps) => join(deps.config.dataDir, 'uploads');

/**
 * What the workspace's attachments add up to, from the rows rather than the
 * disk: the rows are the record of truth, and a stray file nobody references
 * is the maintenance sweep's business, not the quota's.
 */
export function storageUsedBytes(db: DbOrTx): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)` })
    .from(attachments)
    .get();
  // A single aggregate over a table always returns a row, even an empty table
  // — coalesce is what makes that row a zero rather than a NULL.
  if (!row) throw new Error('A sum over the attachments table returned no row.');
  return row.total;
}

/**
 * A file size in the unit a person would say it in. Only the refusal messages
 * use it — the API otherwise reports bytes and lets the browser do the words.
 */
function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}

export function serializeAttachment(row: AttachmentRow, uploaderName: string | null) {
  return {
    id: row.id,
    assetId: row.assetId,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    mime: row.mime,
    uploadedByName: uploaderName,
    createdAt: row.createdAt,
  };
}

/**
 * The uploader is a LEFT JOIN: the member who uploaded a file may since have
 * been removed, and "we no longer know who" is a real answer the column holds.
 */
export function listAttachments(db: Db, assetId: string) {
  return db
    .select({ attachment: attachments, uploader: members })
    .from(attachments)
    .leftJoin(members, eq(members.id, attachments.uploadedByMemberId))
    .where(eq(attachments.assetId, assetId))
    .orderBy(attachments.createdAt)
    .all()
    .map((row) => serializeAttachment(row.attachment, row.uploader?.displayName ?? null));
}

/** The files an asset owns, so a delete can clean them off disk afterwards. */
export function storedNamesForAsset(db: Db, assetId: string): string[] {
  return db
    .select({ storedName: attachments.storedName })
    .from(attachments)
    .where(eq(attachments.assetId, assetId))
    .all()
    .map((row) => row.storedName);
}

/**
 * Streams an upload to disk under a name we generate. The caller's filename is
 * kept only as a label — it is never used as a path, and never trusted.
 *
 * Two policies stand in front of it: the type allowlist, checked on the
 * sanitized extension before a single byte is written, and the workspace's
 * storage quota, checked inside the transaction that would record the file —
 * so two uploads racing each other cannot both find room in the same gap.
 */
export async function saveAttachment(
  deps: AppDeps,
  actor: Actor,
  assetId: string,
  file: UploadedFile,
): Promise<AttachmentRow> {
  const asset = deps.db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) throw notFound('That asset');

  const id = newId();
  const extension = extname(file.filename)
    .slice(0, 12)
    .replace(/[^.A-Za-z0-9]/g, '');
  if (!isAllowedAttachment(extension.slice(1))) {
    // The part must be read to its end or the connection is left mid-body —
    // the response is an error, not a reason to hang up on the browser.
    file.stream.resume();
    throw new AppError(
      422,
      'file_type_not_allowed',
      `${extension === '' ? 'Files with no extension' : `${extension} files`} are not accepted. ` +
        'Attachments can be images, PDFs, office documents, text or archives.',
    );
  }

  const directory = uploadsDir(deps);
  await mkdir(directory, { recursive: true });

  const storedName = `${id}${extension}`;
  const target = join(directory, storedName);

  const digest = createHash('sha256');
  let sizeBytes = 0;
  file.stream.on('data', (chunk: Buffer) => {
    sizeBytes += chunk.length;
    digest.update(chunk);
  });

  try {
    await pipeline(file.stream, createWriteStream(target));
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }

  // @fastify/multipart truncates past the limit rather than throwing, so the
  // half-written file has to be cleaned up here.
  if (file.stream.truncated) {
    await unlink(target).catch(() => {});
    throw new AppError(413, 'file_too_large', 'Attachments are limited to 10 MB.');
  }

  const now = deps.now();
  try {
    return deps.db.transaction((tx) => {
      const quotaMb = getSettings(tx).uploadQuotaMb;
      const used = storageUsedBytes(tx);
      if (used + sizeBytes > quotaMb * BYTES_PER_MB) {
        throw new AppError(
          413,
          'storage_quota_exceeded',
          `This workspace has used ${Math.round(used / BYTES_PER_MB)} MB of its ${quotaMb} MB ` +
            `attachment storage — this ${describeSize(sizeBytes)} file does not fit.`,
        );
      }

      tx.insert(attachments)
        .values({
          id,
          assetId,
          filename: file.filename,
          storedName,
          sizeBytes,
          sha256: digest.digest('hex'),
          mime: file.mimetype,
          uploadedByMemberId: actor.id,
          createdAt: nowIso(now),
        })
        .run();
      writeAudit(
        tx,
        {
          type: 'assets',
          action: 'asset.attachment_added',
          actorMemberId: actor.id,
          actorName: actor.displayName,
          assetId,
          params: { assetName: asset.name, assetTag: asset.assetTag, filename: file.filename },
        },
        now,
      );
      return tx.select().from(attachments).where(eq(attachments.id, id)).get()!;
    });
  } catch (error) {
    // The bytes are on the volume and the row that would have named them is
    // not, which is exactly what the orphan sweep exists to catch — but a file
    // refused for filling the disk must not be the thing that fills it.
    await unlink(target).catch(() => {});
    throw error;
  }
}

export async function deleteAttachment(
  deps: AppDeps,
  actor: Actor,
  attachmentId: string,
): Promise<void> {
  const row = deps.db.select().from(attachments).where(eq(attachments.id, attachmentId)).get();
  if (!row) throw notFound('That attachment');
  // attachments.asset_id is NOT NULL and cascades on delete, so the asset an
  // attachment names always exists. Reading it optionally would only hide the
  // day that stops being true — and write a nameless audit line.
  const asset = deps.db.select().from(assets).where(eq(assets.id, row.assetId)).get();
  if (!asset) throw notFound('That asset');

  const now = deps.now();
  deps.db.transaction((tx) => {
    tx.delete(attachments).where(eq(attachments.id, row.id)).run();
    writeAudit(
      tx,
      {
        type: 'assets',
        action: 'asset.attachment_removed',
        actorMemberId: actor.id,
        actorName: actor.displayName,
        assetId: row.assetId,
        params: { assetName: asset.name, assetTag: asset.assetTag, filename: row.filename },
      },
      now,
    );
  });

  // Best effort: the row is the record of truth, and a stray file is harmless.
  await unlink(join(uploadsDir(deps), row.storedName)).catch(() => {});
}

/** Removes the files an asset owned; call after the rows have cascaded away. */
export async function removeStoredFiles(deps: AppDeps, storedNames: string[]): Promise<void> {
  await Promise.all(
    storedNames.map((name) => unlink(join(uploadsDir(deps), name)).catch(() => {})),
  );
}
