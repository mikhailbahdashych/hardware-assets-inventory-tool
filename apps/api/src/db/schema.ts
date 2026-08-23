import { ENGINE } from './engine.js';
import * as pg from './schema.pg.js';
import * as sqlite from './schema.sqlite.js';

/**
 * The schema every service imports, and the one place that knows there is more
 * than one dialect. The tables are declared twice — `schema.sqlite.ts` and
 * `schema.pg.ts` — and this picks a set at module load.
 *
 * **The cast is the boundary, and it is sound twice over.**
 *
 * It is *type*-sound because the two modules are the same schema: identical
 * table names, identical column names, identical JS-facing column types,
 * nullability, defaults and index and constraint names. That is not an
 * assertion, it is `test/schema-parity.test.ts`, which reads both modules
 * through drizzle's `getTableConfig` and fails on any drift. What a service
 * infers off one of these tables — the row it selects, the values it may
 * insert — is therefore the same shape either way.
 *
 * It is *runtime*-sound because nothing here is faked. Under Postgres these are
 * genuine `pgTable` objects, handed to a genuine node-postgres drizzle instance
 * (`db/client.ts` performs the matching cast on the database). Drizzle's
 * builders dispatch on the dialect of the objects they are given, not on the
 * types that describe them, so the SQL that comes out is Postgres SQL. The cast
 * changes what the compiler is told and nothing about what runs.
 *
 * What it buys is that no service, module, plugin, CLI or test outside this
 * directory contains the word "postgres". They query tables.
 */
const tables = ENGINE === 'postgres' ? (pg as unknown as typeof sqlite) : sqlite;

export const {
  assets,
  assetCustomValues,
  assetStatuses,
  assetStatusTransitions,
  assignments,
  attachments,
  auditEvents,
  authTokens,
  customFieldDefs,
  employees,
  members,
  mfaRecoveryCodes,
  notificationLog,
  orgSettings,
  rolePermissions,
  roles,
  sessions,
} = tables;
