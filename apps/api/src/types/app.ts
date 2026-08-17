import type Database from 'better-sqlite3';
import type { Config } from '@/config.js';
import type { Db } from '@/types/db.js';

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
}

/** What `buildApp()` accepts; only the clock may be left to the caller. */
export interface BuildAppOptions {
  config: Config;
  db: Db;
  sqlite: Database.Database;
  now?: () => Date;
}
