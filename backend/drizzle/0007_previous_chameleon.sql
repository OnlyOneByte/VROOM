CREATE TABLE `user_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain` text NOT NULL,
	`provider_type` text NOT NULL,
	`display_name` text NOT NULL,
	`credentials` text NOT NULL,
	`config` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `up_user_domain_idx` ON `user_providers` (`user_id`,`domain`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `storage_config` text DEFAULT '{"defaults":{"vehicle_photos":null,"expense_receipts":null,"insurance_docs":null,"odometer_readings":null},"providerCategories":{}}';--> statement-breakpoint
CREATE TABLE `photo_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`storage_ref` text NOT NULL,
	`external_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`synced_at` integer,
	`created_at` integer,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `user_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_photo_provider_idx` ON `photo_refs` (`photo_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `pr_pending_idx` ON `photo_refs` (`status`);--> statement-breakpoint
CREATE TABLE `_photos_drive_data` (
	`photo_id` text NOT NULL,
	`drive_file_id` text,
	`web_view_link` text
);
--> statement-breakpoint
INSERT INTO `_photos_drive_data` (`photo_id`, `drive_file_id`, `web_view_link`)
SELECT `id`, `drive_file_id`, `web_view_link` FROM `photos` WHERE `drive_file_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `photos` DROP COLUMN `drive_file_id`;--> statement-breakpoint
ALTER TABLE `photos` DROP COLUMN `web_view_link`;
