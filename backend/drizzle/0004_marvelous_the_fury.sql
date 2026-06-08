-- HAND-AUTHORED (cycle 22, T3). Deliberately replaces the drizzle-generated rebuild.
--
-- WHY: relaxing reminders.next_due_date and reminder_notifications.due_date from NOT NULL to
-- nullable forces a SQLite table rebuild (CREATE __new_ → copy → DROP → rename). The generated
-- order drops `reminders` while `reminder_vehicles` and `reminder_notifications` still hold rows.
-- Both children have `ON DELETE CASCADE` to reminders, so `DROP TABLE reminders` performs an
-- implicit DELETE that CASCADES and wipes every child row. The generated `PRAGMA foreign_keys=OFF`
-- does NOT save us: the migrator (connection.ts runMigrations → drizzle migrate) wraps every
-- migration in a transaction, and PRAGMA foreign_keys is a NO-OP inside an open transaction. This
-- is the C15 lesson (migration-0003 was descoped to additive-only for exactly this reason).
--
-- SAFE ORDER: stash both children in FK-free holding tables → empty the live children so the
-- DROP reminders cascade hits 0 rows → rebuild reminders → rebuild reminder_notifications →
-- refill children from holding (reminder ids are preserved, so FKs resolve). Proven row-for-row
-- by migration-0004.test.ts BEFORE this was committed.
--
-- Stash children (no FK constraints on holding tables → DROP reminders can't cascade into them).
CREATE TABLE `_hold_reminder_vehicles` (
	`reminder_id` text,
	`vehicle_id` text
);--> statement-breakpoint
INSERT INTO `_hold_reminder_vehicles`("reminder_id", "vehicle_id") SELECT "reminder_id", "vehicle_id" FROM `reminder_vehicles`;--> statement-breakpoint
CREATE TABLE `_hold_reminder_notifications` (
	`id` text,
	`reminder_id` text,
	`user_id` text,
	`due_date` integer,
	`due_odometer` integer,
	`is_read` integer,
	`created_at` integer,
	`updated_at` integer
);--> statement-breakpoint
INSERT INTO `_hold_reminder_notifications`("id", "reminder_id", "user_id", "due_date", "due_odometer", "is_read", "created_at", "updated_at") SELECT "id", "reminder_id", "user_id", "due_date", "due_odometer", "is_read", "created_at", "updated_at" FROM `reminder_notifications`;--> statement-breakpoint
-- Empty the live children so the DROP reminders cascade below is a no-op on real data.
DELETE FROM `reminder_notifications`;--> statement-breakpoint
DELETE FROM `reminder_vehicles`;--> statement-breakpoint
-- Rebuild reminders with next_due_date nullable.
CREATE TABLE `__new_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`action_mode` text DEFAULT 'automatic' NOT NULL,
	`frequency` text NOT NULL,
	`interval_value` integer,
	`interval_unit` text,
	`trigger_mode` text DEFAULT 'time' NOT NULL,
	`interval_mileage` integer,
	`last_service_odometer` integer,
	`next_due_odometer` integer,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`next_due_date` integer,
	`expense_category` text,
	`expense_tags` text,
	`expense_amount` real,
	`expense_description` text,
	`expense_split_config` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_triggered_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_reminders`("id", "user_id", "name", "description", "type", "action_mode", "frequency", "interval_value", "interval_unit", "trigger_mode", "interval_mileage", "last_service_odometer", "next_due_odometer", "start_date", "end_date", "next_due_date", "expense_category", "expense_tags", "expense_amount", "expense_description", "expense_split_config", "is_active", "last_triggered_at", "created_at", "updated_at") SELECT "id", "user_id", "name", "description", "type", "action_mode", "frequency", "interval_value", "interval_unit", "trigger_mode", "interval_mileage", "last_service_odometer", "next_due_odometer", "start_date", "end_date", "next_due_date", "expense_category", "expense_tags", "expense_amount", "expense_description", "expense_split_config", "is_active", "last_triggered_at", "created_at", "updated_at" FROM `reminders`;--> statement-breakpoint
DROP TABLE `reminders`;--> statement-breakpoint
ALTER TABLE `__new_reminders` RENAME TO `reminders`;--> statement-breakpoint
CREATE INDEX `reminders_user_active_due_idx` ON `reminders` (`user_id`,`is_active`,`next_due_date`);--> statement-breakpoint
-- Rebuild reminder_notifications with due_date nullable + the partial mileage dedup index.
-- (The live table is empty here; data is restored from the holding table afterward.)
CREATE TABLE `__new_reminder_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`reminder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`due_date` integer,
	`due_odometer` integer,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
DROP TABLE `reminder_notifications`;--> statement-breakpoint
ALTER TABLE `__new_reminder_notifications` RENAME TO `reminder_notifications`;--> statement-breakpoint
CREATE INDEX `rn_user_unread_idx` ON `reminder_notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE UNIQUE INDEX `rn_reminder_due_idx` ON `reminder_notifications` (`reminder_id`,`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `rn_reminder_odo_idx` ON `reminder_notifications` (`reminder_id`,`due_odometer`) WHERE "reminder_notifications"."due_odometer" IS NOT NULL;--> statement-breakpoint
-- Refill children from holding (reminder ids preserved through the rebuild → FKs satisfied).
INSERT INTO `reminder_vehicles`("reminder_id", "vehicle_id") SELECT "reminder_id", "vehicle_id" FROM `_hold_reminder_vehicles`;--> statement-breakpoint
INSERT INTO `reminder_notifications`("id", "reminder_id", "user_id", "due_date", "due_odometer", "is_read", "created_at", "updated_at") SELECT "id", "reminder_id", "user_id", "due_date", "due_odometer", "is_read", "created_at", "updated_at" FROM `_hold_reminder_notifications`;--> statement-breakpoint
DROP TABLE `_hold_reminder_vehicles`;--> statement-breakpoint
DROP TABLE `_hold_reminder_notifications`;
