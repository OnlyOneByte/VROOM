ALTER TABLE `reminder_notifications` ADD `due_odometer` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `trigger_mode` text DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `interval_mileage` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `last_service_odometer` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `next_due_odometer` integer;