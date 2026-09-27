CREATE TABLE `mfa_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mfa_recovery_member_idx` ON `mfa_recovery_codes` (`member_id`);--> statement-breakpoint
ALTER TABLE `members` ADD `mfa_secret` text;--> statement-breakpoint
ALTER TABLE `members` ADD `mfa_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `org_settings` ADD `mfa_required` integer DEFAULT false NOT NULL;