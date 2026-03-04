ALTER TABLE `vehicles` ADD `track_fuel` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `track_charging` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE vehicles SET track_charging = 1 WHERE vehicle_type = 'electric';--> statement-breakpoint
UPDATE vehicles SET track_fuel = 0 WHERE vehicle_type = 'electric';--> statement-breakpoint
UPDATE vehicles SET track_charging = 1 WHERE vehicle_type = 'hybrid';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `google_drive_custom_folder_name` text;--> statement-breakpoint
CREATE TABLE `odometer_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`odometer` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`note` text,
	`linked_entity_type` text,
	`linked_entity_id` text,
	`created_at` integer,
	`updated_at` integer
);--> statement-breakpoint
CREATE INDEX `odometer_vehicle_date_idx` ON `odometer_entries` (`vehicle_id`, `recorded_at`);--> statement-breakpoint
CREATE INDEX `odometer_linked_entity_idx` ON `odometer_entries` (`linked_entity_type`, `linked_entity_id`);
