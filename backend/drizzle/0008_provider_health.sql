ALTER TABLE `user_providers` ADD `last_error_code` text;--> statement-breakpoint
ALTER TABLE `user_providers` ADD `last_checked_at` integer;--> statement-breakpoint
ALTER TABLE `user_providers` ADD `failure_count` integer DEFAULT 0 NOT NULL;