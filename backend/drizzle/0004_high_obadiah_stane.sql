ALTER TABLE `vehicles` ADD `track_fuel` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `track_charging` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE vehicles SET track_charging = 1 WHERE vehicle_type = 'electric';--> statement-breakpoint
UPDATE vehicles SET track_fuel = 0 WHERE vehicle_type = 'electric';--> statement-breakpoint
UPDATE vehicles SET track_charging = 1 WHERE vehicle_type = 'hybrid';