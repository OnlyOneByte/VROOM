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
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `users` ADD `pending_approval_at` integer;--> statement-breakpoint
INSERT OR IGNORE INTO `server_settings` (`id`, `signup_mode`, `allowed_email_domains`, `updated_at`) SELECT 1, 'open', '', CAST(strftime('%s', 'now') AS integer) WHERE EXISTS (SELECT 1 FROM `users` WHERE `id` != 'demo-garage');--> statement-breakpoint
INSERT OR IGNORE INTO `role_assignments` (`id`, `user_id`, `role_id`, `scope_id`, `granted_by`, `created_at`) SELECT lower(hex(randomblob(12))), `id`, 'builtin_admin', NULL, NULL, CAST(strftime('%s', 'now') AS integer) FROM `users` WHERE `id` != 'demo-garage' AND NOT EXISTS (SELECT 1 FROM `role_assignments` WHERE `role_id` = 'builtin_admin' AND `scope_id` IS NULL) AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'builtin_admin') ORDER BY `created_at`, `id` LIMIT 1;