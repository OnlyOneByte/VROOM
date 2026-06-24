CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`start_odometer` integer NOT NULL,
	`end_odometer` integer NOT NULL,
	`purpose` text NOT NULL,
	`trip_date` integer NOT NULL,
	`start_location` text,
	`end_location` text,
	`note` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trips_vehicle_date_idx` ON `trips` (`vehicle_id`,`trip_date`);