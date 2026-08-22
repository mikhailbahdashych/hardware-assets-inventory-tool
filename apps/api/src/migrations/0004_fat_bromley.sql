ALTER TABLE `attachments` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `org_settings` ADD `upload_quota_mb` integer DEFAULT 2048 NOT NULL;