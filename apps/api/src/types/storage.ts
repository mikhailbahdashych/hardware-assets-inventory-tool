import type { Readable } from 'node:stream';

/**
 * One stored object as the orphan sweep needs to see it: the name an
 * `attachments.stored_name` carries — never a bucket key's prefix — and when it
 * was last written, which is the only thing the grace period can be measured
 * against.
 */
export interface StoredObject {
  name: string;
  lastModified: Date;
}

/**
 * Where an attachment's bytes live. The volume under `DATA_DIR` by default, a
 * bucket when `S3_BUCKET` names one — `makeStorage` in `src/services/storage.ts`
 * is what chooses, and nothing above this interface knows which it got.
 *
 * Names are opaque here: the attachment service generates them and this hands
 * them back, so a driver may map a name onto a path or a key however it likes.
 */
export interface AttachmentStorage {
  put(storedName: string, data: Buffer, mime: string): Promise<void>;
  /** Rejects with `ObjectNotStored` when nothing is stored under that name. */
  stream(storedName: string): Promise<Readable>;
  /** Idempotent: removing what is not there is not an error. */
  remove(storedName: string): Promise<void>;
  list(): Promise<StoredObject[]>;
}
