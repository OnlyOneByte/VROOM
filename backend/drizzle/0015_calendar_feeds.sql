CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`options` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cf_user_idx` ON `calendar_feeds` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cf_token_hash_idx` ON `calendar_feeds` (`token_hash`);