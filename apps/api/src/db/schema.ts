import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Conventions (see /CLAUDE.md): TEXT UUID ids, ISO-8601 UTC timestamps,
// date-only values as YYYY-MM-DD text, booleans as 0/1 integers, money as
// integer cents, enums as slugs with NO CHECK constraints (validation lives
// in @inventory/shared zod schemas, so enum additions are code-only).

/** Singleton (id = 1). Row existence marks the instance as initialized. */
export const orgSettings = sqliteTable('org_settings', {
  id: integer('id').primaryKey(),
  orgName: text('org_name').notNull(),
  defaultCurrency: text('default_currency').notNull().default('EUR'),
  assetTagPrefix: text('asset_tag_prefix').notNull().default('AST'),
  warrantyLeadDays: integer('warranty_lead_days').notNull().default(60),
  logRetentionMonths: integer('log_retention_months'),
  emailWarrantyAlerts: integer('email_warranty_alerts', { mode: 'boolean' })
    .notNull()
    .default(true),
  emailReturnReminders: integer('email_return_reminders', { mode: 'boolean' })
    .notNull()
    .default(true),
  emailInvites: integer('email_invites', { mode: 'boolean' }).notNull().default(true),
  emailWeeklyDigest: integer('email_weekly_digest', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Staff who hold assets. Separate from members (logins); optionally linked. */
export const employees = sqliteTable(
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
export const members = sqliteTable(
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
    theme: text('theme').notNull().default('light'),
    density: text('density').notNull().default('comfortable'),
    widgetsJson: text('widgets_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('members_employee_idx').on(table.employeeId)],
);

/** id = sha256(raw cookie token); the raw token never touches the database. */
export const sessions = sqliteTable(
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
export const authTokens = sqliteTable(
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

export const assets = sqliteTable(
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
 * Ownership history — the only truth for "who holds it". At most one active
 * row (returned_at IS NULL) per asset, enforced structurally by a partial
 * unique index. holder_name_snapshot survives employee deletion.
 */
export const assignments = sqliteTable(
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

export const customFieldDefs = sqliteTable('custom_field_defs', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  type: text('type').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const assetCustomValues = sqliteTable(
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

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    storedName: text('stored_name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
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
export const auditEvents = sqliteTable(
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

/** Email idempotency — one row per notification actually sent. */
export const notificationLog = sqliteTable('notification_log', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  sentAt: text('sent_at').notNull(),
});
