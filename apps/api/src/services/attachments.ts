import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '@/types/app.js';
import type { Db } from '@/types/db.js';
import { assets, attachments, members } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { AppError, notFound } from '@/lib/errors.js';
import type { Actor } from '@/types/audit.js';
import type { UploadedFile } from '@/types/attachments.js';
import { writeAudit } from './audit.js';

export type AttachmentRow = typeof attachments.$inferSelect;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Files live beside the database on the one volume a self-host has to back up. */
export const uploadsDir = (deps: AppDeps) => join(deps.config.dataDir, 'uploads');

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
 */
export async function saveAttachment(
  deps: AppDeps,
  actor: Actor,
  assetId: string,
  file: UploadedFile,
): Promise<AttachmentRow> {
  const asset = deps.db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) throw notFound('That asset');

  const directory = uploadsDir(deps);
  await mkdir(directory, { recursive: true });

  const id = newId();
  const extension = extname(file.filename)
    .slice(0, 12)
    .replace(/[^.A-Za-z0-9]/g, '');
  const storedName = `${id}${extension}`;
  const target = join(directory, storedName);

  let sizeBytes = 0;
  file.stream.on('data', (chunk: Buffer) => {
    sizeBytes += chunk.length;
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
  return deps.db.transaction((tx) => {
    tx.insert(attachments)
      .values({
        id,
        assetId,
        filename: file.filename,
        storedName,
        sizeBytes,
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
