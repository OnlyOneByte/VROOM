CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`category` text NOT NULL,
	`tags` text,
	`date` integer NOT NULL,
	`mileage` integer,
	`description` text,
	`receipt_url` text,
	`created_at` integer,
	`updated_at` integer,
	`expense_amount` real NOT NULL,
	`fuel_amount` real,
	`fuel_type` text,
	`is_financing_payment` integer DEFAULT false NOT NULL,
	`insurance_policy_id` text,
	`insurance_term_id` text,
	`missed_fillup` integer DEFAULT false NOT NULL,
	`user_id` text NOT NULL,
	`group_id` text,
	`group_total` real,
	`split_method` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expenses_vehicle_date_idx` ON `expenses` (`vehicle_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_vehicle_category_date_idx` ON `expenses` (`vehicle_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_category_date_idx` ON `expenses` (`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_user_date_idx` ON `expenses` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_user_category_date_idx` ON `expenses` (`user_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_group_idx` ON `expenses` (`group_id`);--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`current_term_start` integer,
	`current_term_end` integer,
	`terms` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_policies_user_id_idx` ON `insurance_policies` (`user_id`);--> statement-breakpoint
CREATE TABLE `insurance_policy_vehicles` (
	`policy_id` text NOT NULL,
	`term_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	PRIMARY KEY(`policy_id`, `term_id`, `vehicle_id`),
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ipv_vehicle_policy_idx` ON `insurance_policy_vehicles` (`vehicle_id`,`policy_id`);--> statement-breakpoint
CREATE TABLE `odometer_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`odometer` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`note` text,
	`linked_entity_type` text,
	`linked_entity_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `odometer_vehicle_date_idx` ON `odometer_entries` (`vehicle_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `odometer_linked_entity_idx` ON `odometer_entries` (`linked_entity_type`,`linked_entity_id`);--> statement-breakpoint
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
CREATE INDEX `pr_pending_idx` ON `photo_refs` (`status`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `photos_entity_idx` ON `photos` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain` text NOT NULL,
	`provider_type` text NOT NULL,
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
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL,
	`currency_unit` text DEFAULT 'USD' NOT NULL,
	`auto_backup_enabled` integer DEFAULT false NOT NULL,
	`backup_frequency` text DEFAULT 'weekly' NOT NULL,
	`last_backup_date` integer,
	`storage_config` text DEFAULT '{"defaults":{"vehicle_photos":null,"expense_receipts":null,"insurance_docs":null,"odometer_readings":null},"providerCategories":{}}',
	`backup_config` text DEFAULT '{"providers":{}}',
	`sync_on_inactivity` integer DEFAULT true NOT NULL,
	`sync_inactivity_minutes` integer DEFAULT 5 NOT NULL,
	`last_sync_date` integer,
	`last_data_change_date` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`provider_id` text NOT NULL,
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
	`current_balance` real NOT NULL,
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
	`current_insurance_policy_id` text,
	`unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_insurance_policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vehicles_user_id_idx` ON `vehicles` (`user_id`);