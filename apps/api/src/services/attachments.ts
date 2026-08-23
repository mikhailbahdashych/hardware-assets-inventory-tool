import { createHash } from 'node:crypto';
import { extname } from 'node:path';
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

/**
 * What the workspace's attachments add up to, from the rows rather than the
 * disk: the rows are the record of truth, and a stray file nobody references
 * is the maintenance sweep's business, not the quota's.
 */
export async function storageUsedBytes(db: DbOrTx): Promise<number> {
  const [row] = await db
    // `.mapWith(Number)` is not decoration: Postgres sums integers into a
    // bigint and node-postgres hands a bigint over as a string, so without it
    // the quota would compare a number against `"2147483"` and always fit.
    .select({ total: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)`.mapWith(Number) })
    .from(attachments);
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
export async function listAttachments(db: Db, assetId: string) {
  return (
    await db
      .select({ attachment: attachments, uploader: members })
      .from(attachments)
      .leftJoin(members, eq(members.id, attachments.uploadedByMemberId))
      .where(eq(attachments.assetId, assetId))
      .orderBy(attachments.createdAt)
  ).map((row) => serializeAttachment(row.attachment, row.uploader?.displayName ?? null));
}

/** The files an asset owns, so a delete can clean them off disk afterwards. */
export async function storedNamesForAsset(db: Db, assetId: string): Promise<string[]> {
  return (
    await db
      .select({ storedName: attachments.storedName })
      .from(attachments)
      .where(eq(attachments.assetId, assetId))
  ).map((row) => row.storedName);
}

/**
 * Stores an upload under a name we generate. The caller's filename is kept only
 * as a label — it is never used as a path or a key, and never trusted.
 *
 * Two policies stand in front of it: the type allowlist, checked on the
 * sanitized extension before a single byte is read, and the workspace's storage
 * quota, checked inside the transaction that would record the file — so two
 * uploads racing each other cannot both find room in the same gap.
 *
 * The part is buffered rather than piped, because a bucket takes a body rather
 * than a stream of one. @fastify/multipart stops at 10 MB, so that is the whole
 * of what can be held — the same limit that was already the file's ceiling.
 */
export async function saveAttachment(
  deps: AppDeps,
  actor: Actor,
  assetId: string,
  file: UploadedFile,
): Promise<AttachmentRow> {
  const [asset] = await deps.db.select().from(assets).where(eq(assets.id, assetId));
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

  const storedName = `${id}${extension}`;

  const digest = createHash('sha256');
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of file.stream) {
    const bytes = Buffer.from(chunk);
    chunks.push(bytes);
    sizeBytes += bytes.length;
    digest.update(bytes);
  }

  // @fastify/multipart truncates past the limit rather than throwing, so what
  // arrived is the front of a file and nothing may be stored under its name.
  if (file.stream.truncated) {
    throw new AppError(413, 'file_too_large', 'Attachments are limited to 10 MB.');
  }

  try {
    await deps.storage.put(storedName, Buffer.concat(chunks), file.mimetype);
  } catch (error) {
    // A put that failed partway may still have left something under the name.
    await deps.storage.remove(storedName).catch(() => {});
    throw error;
  }

  const now = deps.now();
  try {
    return await deps.db.transaction(async (tx) => {
      const quotaMb = (await getSettings(tx)).uploadQuotaMb;
      const used = await storageUsedBytes(tx);
      if (used + sizeBytes > quotaMb * BYTES_PER_MB) {
        throw new AppError(
          413,
          'storage_quota_exceeded',
          `This workspace has used ${Math.round(used / BYTES_PER_MB)} MB of its ${quotaMb} MB ` +
            `attachment storage — this ${describeSize(sizeBytes)} file does not fit.`,
        );
      }

      await tx.insert(attachments).values({
        id,
        assetId,
        filename: file.filename,
        storedName,
        sizeBytes,
        sha256: digest.digest('hex'),
        mime: file.mimetype,
        uploadedByMemberId: actor.id,
        createdAt: nowIso(now),
      });
      await writeAudit(
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
      return (await tx.select().from(attachments).where(eq(attachments.id, id)))[0]!;
    });
  } catch (error) {
    // The bytes are stored and the row that would have named them is not, which
    // is exactly what the orphan sweep exists to catch — but a file refused for
    // filling the disk must not be the thing that fills it.
    await deps.storage.remove(storedName).catch(() => {});
    throw error;
  }
}

export async function deleteAttachment(
  deps: AppDeps,
  actor: Actor,
  attachmentId: string,
): Promise<void> {
  const [row] = await deps.db.select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!row) throw notFound('That attachment');
  // attachments.asset_id is NOT NULL and cascades on delete, so the asset an
  // attachment names always exists. Reading it optionally would only hide the
  // day that stops being true — and write a nameless audit line.
  const [asset] = await deps.db.select().from(assets).where(eq(assets.id, row.assetId));
  if (!asset) throw notFound('That asset');

  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.id, row.id));
    await writeAudit(
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
  await deps.storage.remove(row.storedName).catch(() => {});
}

/** Removes the files an asset owned; call after the rows have cascaded away. */
export async function removeStoredFiles(deps: AppDeps, storedNames: string[]): Promise<void> {
  await Promise.all(storedNames.map((name) => deps.storage.remove(name).catch(() => {})));
}
