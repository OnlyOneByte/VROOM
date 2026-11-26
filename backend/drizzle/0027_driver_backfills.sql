CREATE TABLE `driver_backfills` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`mode` text NOT NULL,
	`entries` text NOT NULL,
	`created_by` text,
	`created_at` integer,
	`undone_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `driver_backfills_vehicle_idx` ON `driver_backfills` (`vehicle_id`,`created_at`);