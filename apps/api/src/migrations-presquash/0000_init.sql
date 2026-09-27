CREATE TABLE `asset_custom_values` (
	`asset_id` text NOT NULL,
	`field_def_id` text NOT NULL,
	`value` text,
	PRIMARY KEY(`asset_id`, `field_def_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_def_id`) REFERENCES `custom_field_defs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_tag` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`model` text,
	`serial_number` text,
	`status` text DEFAULT 'available' NOT NULL,
	`purchase_date` text,
	`purchase_price_cents` integer,
	`currency` text,
	`supplier` text,
	`warranty_until` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_asset_tag_unique` ON `assets` (`asset_tag`);--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);--> statement-breakpoint
CREATE INDEX `assets_category_idx` ON `assets` (`category`);--> statement-breakpoint
CREATE INDEX `assets_warranty_idx` ON `assets` (`warranty_until`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`employee_id` text,
	`holder_name_snapshot` text NOT NULL,
	`checked_out_at` text NOT NULL,
	`expected_return_date` text,
	`returned_at` text,
	`checkout_notes` text,
	`checkin_condition` text,
	`checkin_new_status` text,
	`checkin_notes` text,
	`outcome` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_one_active_per_asset` ON `assignments` (`asset_id`) WHERE returned_at IS NULL;--> statement-breakpoint
CREATE INDEX `assignments_employee_idx` ON `assignments` (`employee_id`);--> statement-breakpoint
CREATE INDEX `assignments_asset_history_idx` ON `assignments` (`asset_id`,`checked_out_at`);--> statement-breakpoint
CREATE INDEX `assignments_pending_return_idx` ON `assignments` (`expected_return_date`) WHERE returned_at IS NULL;--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`filename` text NOT NULL,
	`stored_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mime` text,
	`uploaded_by_member_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachments_asset_idx` ON `attachments` (`asset_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`actor_member_id` text,
	`actor_name` text NOT NULL,
	`asset_id` text,
	`employee_id` text,
	`member_id` text,
	`params` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_events` (`at`);--> statement-breakpoint
CREATE INDEX `audit_asset_idx` ON `audit_events` (`asset_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_type_idx` ON `audit_events` (`type`,`at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_member_idx` ON `auth_tokens` (`member_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `custom_field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_defs_key_unique` ON `custom_field_defs` (`key`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`job_title` text,
	`department` text,
	`location` text,
	`employee_code` text,
	`start_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_email_unique` ON `employees` (`email`);--> statement-breakpoint
CREATE INDEX `employees_status_idx` ON `employees` (`status`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`employee_id` text,
	`last_active_at` text,
	`theme` text DEFAULT 'light' NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`widgets_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE INDEX `members_employee_idx` ON `members` (`employee_id`);--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_dedupe_key_unique` ON `notification_log` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `org_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`org_name` text NOT NULL,
	`default_currency` text DEFAULT 'EUR' NOT NULL,
	`asset_tag_prefix` text DEFAULT 'AST' NOT NULL,
	`warranty_lead_days` integer DEFAULT 60 NOT NULL,
	`log_retention_months` integer,
	`email_warranty_alerts` integer DEFAULT true NOT NULL,
	`email_return_reminders` integer DEFAULT true NOT NULL,
	`email_invites` integer DEFAULT true NOT NULL,
	`email_weekly_digest` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_member_idx` ON `sessions` (`member_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);