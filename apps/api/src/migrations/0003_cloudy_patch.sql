CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`action` text NOT NULL,
	PRIMARY KEY(`role_id`, `action`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`color` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_label_unique` ON `roles` (`label`);