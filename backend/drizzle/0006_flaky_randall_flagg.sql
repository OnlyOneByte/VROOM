-- Step 1: Add unit_preferences to vehicles
ALTER TABLE `vehicles` ADD `unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL;--> statement-breakpoint

-- Step 2: Backfill vehicles from user_settings
UPDATE `vehicles` SET `unit_preferences` = (
  SELECT json_object(
    'distanceUnit', COALESCE(us.distance_unit, 'miles'),
    'volumeUnit', COALESCE(us.volume_unit, 'gallons_us'),
    'chargeUnit', COALESCE(us.charge_unit, 'kwh')
  )
  FROM `user_settings` us WHERE us.user_id = `vehicles`.user_id
)
WHERE EXISTS (SELECT 1 FROM `user_settings` us WHERE us.user_id = `vehicles`.user_id);--> statement-breakpoint

-- Step 3: Add unit_preferences to user_settings
ALTER TABLE `user_settings` ADD `unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL;--> statement-breakpoint

-- Step 4: Backfill user_settings from existing columns
UPDATE `user_settings` SET `unit_preferences` = json_object(
  'distanceUnit', COALESCE(distance_unit, 'miles'),
  'volumeUnit', COALESCE(volume_unit, 'gallons_us'),
  'chargeUnit', COALESCE(charge_unit, 'kwh')
);--> statement-breakpoint

-- Step 5: Drop old separate columns from user_settings
ALTER TABLE `user_settings` DROP COLUMN `distance_unit`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `volume_unit`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `charge_unit`;
