CREATE TABLE `server_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_by` text,
	`created_at` integer,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `server_invites_email_idx` ON `server_invites` (`email`);--> statement-breakpoint
CREATE TABLE `server_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`signup_mode` text DEFAULT 'invite' NOT NULL,
	`allowed_email_domains` text DEFAULT '' NOT NULL,
	`updated_at` integer,
	`updated_by` text,
	`admin_assigned_at` integer,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `users` ADD `pending_approval_at` integer;--> statement-breakpoint
INSERT OR IGNORE INTO `server_settings` (`id`, `signup_mode`, `allowed_email_domains`, `updated_at`) SELECT 1, 'open', '', CAST(strftime('%s', 'now') AS integer) WHERE EXISTS (SELECT 1 FROM `users` WHERE `id` != 'demo-garage');