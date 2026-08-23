import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// The PostgreSQL half of the schema in `schema.sqlite.ts`. Same tables, same
// column names, same index names — `test/schema-parity.test.ts` fails if any of
// that drifts, and `db/schema.ts` casts these tables to the SQLite ones on the
// strength of it.
//
// The column mapping is parity first, and two choices in it are deliberate:
//
// - **Timestamps and dates stay `text`.** They are ISO-8601 UTC strings and
//   `YYYY-MM-DD` strings everywhere in this codebase, compared and ordered
//   lexicographically (the warranty window, the audit cursor, every `lt`
//   against a cutoff). A `timestamptz` or a `date` column here would hand
//   services a `Date` on one engine and a string on the other, which is a fork
//   in behaviour rather than a nicer type.
// - **Booleans become real booleans.** SQLite stores them as 0/1 integers and
//   drizzle's `{ mode: 'boolean' }` presents them to JavaScript as `true` and
//   `false`; pg `boolean()` presents the same thing. The JS-facing type is what
//   has to match, and it does — which is also what keeps `JSON.stringify` of a
//   settings row identical on both engines.
//
// The rest maps straight across: text ids stay text, money stays integer cents,
// JSON-in-text stays text.

/** Singleton (id = 1). Row existence marks the instance as initialized. */
export const orgSettings = pgTable('org_settings', {
  /**
   * SQLite's `INTEGER PRIMARY KEY` is the rowid alias: supply a value and it is
   * used, omit it and the table provides one. Identity-by-default is the same
   * bargain in Postgres, and saying so keeps the column optional on insert in
   * both dialects — which is the parity the cast in `schema.ts` rests on. Both
   * writers pass `id: 1` anyway; this table has exactly one row.
   */
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  orgName: text('org_name').notNull(),
  defaultCurrency: text('default_currency').notNull().default('EUR'),
  assetTagPrefix: text('asset_tag_prefix').notNull().default('AST'),
  warrantyLeadDays: integer('warranty_lead_days').notNull().default(60),
  logRetentionMonths: integer('log_retention_months'),
  emailWarrantyAlerts: boolean('email_warranty_alerts').notNull().default(true),
  emailReturnReminders: boolean('email_return_reminders').notNull().default(true),
  emailInvites: boolean('email_invites').notNull().default(true),
  emailWeeklyDigest: boolean('email_weekly_digest').notNull().default(false),
  /** Global: every member must hold a confirmed authenticator to use the app. */
  mfaRequired: boolean('mfa_required').notNull().default(false),
  /**
   * How many megabytes of attachments this workspace may hold. The database
   * shares the volume, so this is what stops uploads from taking it down.
   */
  uploadQuotaMb: integer('upload_quota_mb').notNull().default(2048),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Staff who hold assets. Separate from members (logins); optionally linked. */
export const employees = pgTable(
  'employees',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull().unique(),
    jobTitle: text('job_title'),
    department: text('department'),
    location: text('location'),
    employeeCode: text('employee_code'),
    startDate: text('start_date'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('employees_status_idx').on(table.status)],
);

/** Login accounts. password_hash stays NULL until an invite is accepted. */
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role').notNull(),
    status: text('status').notNull(),
    employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    lastActiveAt: text('last_active_at'),
    /**
     * The base32 TOTP secret. Reversible by necessity — verifying a code
     * means recomputing it, which a hash cannot do. Whoever can read this
     * column can mint codes, so it is exactly as sensitive as the database
     * itself, which already holds every session and token hash.
     */
    mfaSecret: text('mfa_secret'),
    /** Set when a first code verified. Null with a secret set = mid-enrolment. */
    mfaConfirmedAt: text('mfa_confirmed_at'),
    theme: text('theme').notNull().default('light'),
    density: text('density').notNull().default('comfortable'),
    widgetsJson: text('widgets_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('members_employee_idx').on(table.employeeId)],
);

/**
 * The workspace's roles. Editable data rather than a code enum, which is why
 * `members.role` above stays plain TEXT with no FK: it carries the slug, the
 * roles service validates it, and deleting a role migrates every member holding
 * it in the same transaction rather than leaving the column to a cascade.
 */
export const roles = pgTable('roles', {
  /** The slug, derived from the label once and never changed afterwards. */
  id: text('id').primaryKey(),
  /** Unique here and case-insensitively in the service — two roles one letter
   *  apart are two ways to be surprised by what somebody may do. */
  label: text('label').notNull().unique(),
  description: text('description'),
  color: text('color').notNull(),
  /** True only for Admin: every action always, including future ones. */
  isSystem: boolean('is_system').notNull().default(false),
  /** Pills, the members table, the invite cards and the matrix share it. */
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * One row per granted action. The system role has none on purpose — its set is
 * `ACTIONS` by definition, resolved in `resolvePermissions`, which is what
 * makes an action added in a future version Admin's with no reconciliation at
 * boot. `action` is plain TEXT like every other slug column: a grant naming an
 * action this build dropped is ignored when permissions resolve.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.action] })],
);

/** id = sha256(raw cookie token); the raw token never touches the database. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('sessions_member_idx').on(table.memberId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

/** Invite + password-reset tokens, hashed like sessions. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('auth_tokens_member_idx').on(table.memberId, table.purpose)],
);

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    assetTag: text('asset_tag').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    model: text('model'),
    serialNumber: text('serial_number'),
    status: text('status').notNull().default('available'),
    purchaseDate: text('purchase_date'),
    purchasePriceCents: integer('purchase_price_cents'),
    currency: text('currency'),
    supplier: text('supplier'),
    warrantyUntil: text('warranty_until'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('assets_status_idx').on(table.status),
    index('assets_category_idx').on(table.category),
    index('assets_warranty_idx').on(table.warrantyUntil),
  ],
);

/**
 * The workspace's asset statuses. Editable data rather than a code enum, which
 * is why `assets.status` above stays plain TEXT with no FK: an asset keeps the
 * slug it carries even if somebody deletes the status, and the services decide
 * what is legal by reading these rows.
 */
export const assetStatuses = pgTable('asset_statuses', {
  /** The slug, derived from the label once and never changed afterwards. */
  id: text('id').primaryKey(),
  /** Unique here and case-insensitively in the service — two statuses one
   *  letter apart are two ways to lose track of the same asset. */
  label: text('label').notNull().unique(),
  color: text('color').notNull(),
  /** True only for `assigned`: assign and check-in are its only doors. */
  isSystem: boolean('is_system').notNull().default(false),
  assignableFrom: boolean('assignable_from').notNull().default(false),
  checkinTarget: boolean('checkin_target').notNull().default(false),
  /** Pills, tiles, selects and the matrix all read this one order. */
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * The transition graph: one row per allowed direct move. Deleting a status
 * takes its edges with it, which is the whole reason these are real foreign
 * keys while `assets.status` is not — an edge to nowhere has no meaning, and
 * an asset in a retired status still has to render.
 */
export const assetStatusTransitions = pgTable(
  'asset_status_transitions',
  {
    fromStatus: text('from_status')
      .notNull()
      .references(() => assetStatuses.id, { onDelete: 'cascade' }),
    toStatus: text('to_status')
      .notNull()
      .references(() => assetStatuses.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.fromStatus, table.toStatus] })],
);

/**
 * Ownership history — the only truth for "who holds it". At most one active
 * row (returned_at IS NULL) per asset, enforced structurally by a partial
 * unique index, which Postgres supports natively and under the same name.
 * holder_name_snapshot survives employee deletion.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    holderNameSnapshot: text('holder_name_snapshot').notNull(),
    checkedOutAt: text('checked_out_at').notNull(),
    expectedReturnDate: text('expected_return_date'),
    returnedAt: text('returned_at'),
    checkoutNotes: text('checkout_notes'),
    checkinCondition: text('checkin_condition'),
    checkinNewStatus: text('checkin_new_status'),
    checkinNotes: text('checkin_notes'),
    outcome: text('outcome'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('assignments_one_active_per_asset')
      .on(table.assetId)
      .where(sql`returned_at IS NULL`),
    index('assignments_employee_idx').on(table.employeeId),
    index('assignments_asset_history_idx').on(table.assetId, table.checkedOutAt),
    index('assignments_pending_return_idx')
      .on(table.expectedReturnDate)
      .where(sql`returned_at IS NULL`),
  ],
);

export const customFieldDefs = pgTable('custom_field_defs', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  type: text('type').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const assetCustomValues = pgTable(
  'asset_custom_values',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    fieldDefId: text('field_def_id')
      .notNull()
      .references(() => customFieldDefs.id, { onDelete: 'cascade' }),
    value: text('value'),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.fieldDefId] })],
);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    storedName: text('stored_name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /**
     * Hex sha256 of the stored bytes, computed as the upload streamed past.
     * **NULL means the file was uploaded before checksums existed** — not that
     * it has none, which is why the column is nullable and nothing backfills it.
     */
    sha256: text('sha256'),
    mime: text('mime'),
    uploadedByMemberId: text('uploaded_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('attachments_asset_idx').on(table.assetId)],
);

/**
 * Structured audit events; sentences are rendered by the shared renderer.
 * Subject ref columns have no FK constraints so pruning/deletion never blocks.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    type: text('type').notNull(),
    action: text('action').notNull(),
    actorMemberId: text('actor_member_id').references(() => members.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    assetId: text('asset_id'),
    employeeId: text('employee_id'),
    memberId: text('member_id'),
    params: text('params').notNull().default('{}'),
  },
  (table) => [
    index('audit_at_idx').on(table.at),
    index('audit_asset_idx').on(table.assetId, table.at),
    index('audit_type_idx').on(table.type, table.at),
  ],
);

/**
 * Single-use recovery codes, hashed exactly like sessions and invite tokens:
 * the raw code exists once, in the response that created the set. Ten per
 * member, and `usedAt` is what makes one single-use rather than a password.
 */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** sha256(raw). A recovery code is a password that works once. */
    codeHash: text('code_hash').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('mfa_recovery_member_idx').on(table.memberId)],
);

/** Email idempotency — one row per notification actually sent. */
export const notificationLog = pgTable('notification_log', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  sentAt: text('sent_at').notNull(),
});
