CREATE TABLE `vehicle_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`shared_with_id` text NOT NULL,
	`level` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_shares_active_idx` ON `vehicle_shares` (`vehicle_id`,`shared_with_id`) WHERE status in ('pending','accepted');--> statement-breakpoint
CREATE INDEX `vehicle_shares_shared_with_idx` ON `vehicle_shares` (`shared_with_id`,`status`);--> statement-breakpoint
CREATE INDEX `vehicle_shares_owner_idx` ON `vehicle_shares` (`owner_id`);
