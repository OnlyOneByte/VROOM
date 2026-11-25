CREATE TABLE `vehicle_drivers` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`color` text,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vehicle_drivers_vehicle_idx` ON `vehicle_drivers` (`vehicle_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_drivers_vehicle_user_idx` ON `vehicle_drivers` (`vehicle_id`,`user_id`) WHERE "vehicle_drivers"."user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `paid_by_driver_id` text REFERENCES vehicle_drivers(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `odometer_entries` ADD `driver_id` text REFERENCES vehicle_drivers(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `trips` ADD `driver_id` text REFERENCES vehicle_drivers(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `car_share_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `car_share_rules` text;