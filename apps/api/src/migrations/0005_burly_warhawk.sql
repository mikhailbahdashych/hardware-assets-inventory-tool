CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`dedupe_key` text,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_member_idx` ON `notifications` (`member_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_idx` ON `notifications` (`member_id`,`dedupe_key`);--> statement-breakpoint
DROP TABLE `notification_log`;--> statement-breakpoint
ALTER TABLE `org_settings` DROP COLUMN `email_invites`;--> statement-breakpoint
ALTER TABLE `org_settings` DROP COLUMN `email_weekly_digest`;