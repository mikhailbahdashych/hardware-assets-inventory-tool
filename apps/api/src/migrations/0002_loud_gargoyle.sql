CREATE TABLE `asset_status_transitions` (
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	PRIMARY KEY(`from_status`, `to_status`),
	FOREIGN KEY (`from_status`) REFERENCES `asset_statuses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_status`) REFERENCES `asset_statuses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`assignable_from` integer DEFAULT false NOT NULL,
	`checkin_target` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_statuses_label_unique` ON `asset_statuses` (`label`);