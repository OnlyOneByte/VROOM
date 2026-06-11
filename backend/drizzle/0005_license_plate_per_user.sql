DROP INDEX `vehicles_license_plate_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_user_license_plate_idx` ON `vehicles` (`user_id`,`license_plate`) WHERE `license_plate` IS NOT NULL;
