import type Database from 'better-sqlite3';
import type { Config } from '@/types/config.js';
import type { Db } from '@/types/db.js';
import type { Mailer } from '@/types/mail.js';

/**
 * Everything a route or a service is handed. Nothing here is looked up from
 * the environment — including the clock, which is what makes the app testable.
 */
export interface AppDeps {
  config: Config;
  db: Db;
  sqlite: Database.Database;
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
  sqlite: Database.Database;
  now?: () => Date;
  /** Omitted means "build one from the config", which may still be null. */
  mailer?: Mailer | null;
}
