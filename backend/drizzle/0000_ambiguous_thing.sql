CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`category` text NOT NULL,
	`tags` text,
	`date` integer NOT NULL,
	`mileage` integer,
	`description` text,
	`created_at` integer,
	`updated_at` integer,
	`expense_amount` real NOT NULL,
	`volume` real,
	`fuel_type` text,
	`is_financing_payment` integer DEFAULT false NOT NULL,
	`insurance_term_id` text,
	`missed_fillup` integer DEFAULT false NOT NULL,
	`user_id` text NOT NULL,
	`group_id` text,
	`group_total` real,
	`split_method` text,
	`source_type` text,
	`source_id` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`insurance_term_id`) REFERENCES `insurance_terms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expenses_vehicle_date_idx` ON `expenses` (`vehicle_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_vehicle_category_date_idx` ON `expenses` (`vehicle_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_category_date_idx` ON `expenses` (`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_user_date_idx` ON `expenses` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_user_category_date_idx` ON `expenses` (`user_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_group_idx` ON `expenses` (`group_id`);--> statement-breakpoint
CREATE INDEX `expenses_insurance_term_idx` ON `expenses` (`insurance_term_id`);--> statement-breakpoint
CREATE INDEX `expenses_source_idx` ON `expenses` (`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_policies_user_id_idx` ON `insurance_policies` (`user_id`);--> statement-breakpoint
CREATE TABLE `insurance_term_vehicles` (
	`term_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	PRIMARY KEY(`term_id`, `vehicle_id`),
	FOREIGN KEY (`term_id`) REFERENCES `insurance_terms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `itv_vehicle_idx` ON `insurance_term_vehicles` (`vehicle_id`);--> statement-breakpoint
CREATE TABLE `insurance_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL,
	`policy_number` text,
	`coverage_description` text,
	`deductible_amount` real,
	`coverage_limit` real,
	`agent_name` text,
	`agent_phone` text,
	`agent_email` text,
	`total_cost` real,
	`monthly_cost` real,
	`premium_frequency` text,
	`payment_amount` real,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `it_policy_id_idx` ON `insurance_terms` (`policy_id`);--> statement-breakpoint
CREATE INDEX `it_policy_end_date_idx` ON `insurance_terms` (`policy_id`,`end_date`);--> statement-breakpoint
CREATE TABLE `odometer_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`odometer` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`note` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `odometer_vehicle_date_idx` ON `odometer_entries` (`vehicle_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `photo_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`storage_ref` text NOT NULL,
	`external_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`synced_at` integer,
	`created_at` integer,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `user_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_photo_provider_idx` ON `photo_refs` (`photo_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photos_entity_idx` ON `photos` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `photos_user_entity_type_idx` ON `photos` (`user_id`,`entity_type`);--> statement-breakpoint
CREATE TABLE `reminder_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`reminder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`due_date` integer NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rn_user_unread_idx` ON `reminder_notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE UNIQUE INDEX `rn_reminder_due_idx` ON `reminder_notifications` (`reminder_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `reminder_vehicles` (
	`reminder_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	PRIMARY KEY(`reminder_id`, `vehicle_id`),
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rv_vehicle_idx` ON `reminder_vehicles` (`vehicle_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`action_mode` text DEFAULT 'automatic' NOT NULL,
	`frequency` text NOT NULL,
	`interval_value` integer,
	`interval_unit` text,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`next_due_date` integer NOT NULL,
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
);
--> statement-breakpoint
CREATE INDEX `reminders_user_active_due_idx` ON `reminders` (`user_id`,`is_active`,`next_due_date`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_sync_date` integer,
	`last_data_change_date` integer,
	`last_backup_date` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL,
	`currency_unit` text DEFAULT 'USD' NOT NULL,
	`auto_backup_enabled` integer DEFAULT false NOT NULL,
	`backup_frequency` text DEFAULT 'weekly' NOT NULL,
	`sync_on_inactivity` integer DEFAULT true NOT NULL,
	`sync_inactivity_minutes` integer DEFAULT 5 NOT NULL,
	`storage_config` text DEFAULT '{"defaults":{"vehicle_photos":null,"expense_receipts":null,"insurance_docs":null,"odometer_readings":null},"providerCategories":{}}',
	`backup_config` text DEFAULT '{"providers":{}}',
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain` text NOT NULL,
	`provider_type` text NOT NULL,
	`provider_account_id` text,
	`display_name` text NOT NULL,
	`credentials` text NOT NULL,
	`config` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `up_user_domain_idx` ON `user_providers` (`user_id`,`domain`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vehicle_financing` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`financing_type` text DEFAULT 'loan' NOT NULL,
	`provider` text NOT NULL,
	`original_amount` real NOT NULL,
	`apr` real,
	`term_months` integer NOT NULL,
	`start_date` integer NOT NULL,
	`payment_amount` real NOT NULL,
	`payment_frequency` text DEFAULT 'monthly' NOT NULL,
	`payment_day_of_month` integer,
	`payment_day_of_week` integer,
	`residual_value` real,
	`mileage_limit` integer,
	`excess_mileage_fee` real,
	`is_active` integer DEFAULT true NOT NULL,
	`end_date` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vf_vehicle_id_idx` ON `vehicle_financing` (`vehicle_id`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`year` integer NOT NULL,
	`vehicle_type` text DEFAULT 'gas' NOT NULL,
	`track_fuel` integer DEFAULT true NOT NULL,
	`track_charging` integer DEFAULT false NOT NULL,
	`license_plate` text,
	`nickname` text,
	`vin` text,
	`initial_mileage` integer,
	`purchase_price` real,
	`purchase_date` integer,
	`unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vehicles_user_id_idx` ON `vehicles` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS vf_active_vehicle_idx ON vehicle_financing (vehicle_id) WHERE is_active = 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_license_plate_idx ON vehicles (license_plate) WHERE license_plate IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS up_auth_identity_idx ON user_providers (provider_type, provider_account_id) WHERE domain = 'auth' AND provider_account_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pr_pending_idx ON photo_refs (status, created_at) WHERE status IN ('pending', 'failed') AND retry_count < 3;
