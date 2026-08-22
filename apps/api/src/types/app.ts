import type { Config } from '@/types/config.js';
import type { Db, DbClient } from '@/types/db.js';
import type { Mailer } from '@/types/mail.js';
import type { AttachmentStorage } from '@/types/storage.js';

/**
 * Everything a route or a service is handed. Nothing here is looked up from
 * the environment — including the clock, which is what makes the app testable.
 */
export interface AppDeps {
  config: Config;
  db: Db;
  /**
   * The driver behind `db`, for the health check that pings it and the shutdown
   * that closes it. Every query goes through `db`.
   */
  client: DbClient;
  /**
   * Where attachment bytes go: the volume, or a bucket when one is named. The
   * services never learn which — see `src/services/storage.ts`.
   */
  storage: AttachmentStorage;
  /** Injectable clock — tests control time through it. */
  now: () => Date;
  /**
   * `null` when this instance has no SMTP, which is a supported way to run it.
   * Null rather than a no-op object so the compiler makes every send site say
   * what it does without email — and every one of them has an answer.
   */
  mailer: Mailer | null;
}

/** What `buildApp()` accepts; only the clock may be left to the caller. */
export interface BuildAppOptions {
  config: Config;
  db: Db;
  client: DbClient;
  now?: () => Date;
  /** Omitted means "build one from the config" — the volume, or the bucket. */
  storage?: AttachmentStorage;
  /** Omitted means "build one from the config", which may still be null. */
  mailer?: Mailer | null;
  /**
   * Where log lines go. The same kind of seam as `now`: production writes to
   * stdout, and a test hands in a stream so it can assert on what was written —
   * which is how "no raw token ever reaches the log" is a test rather than a
   * hope.
   */
  logDestination?: NodeJS.WritableStream;
}
