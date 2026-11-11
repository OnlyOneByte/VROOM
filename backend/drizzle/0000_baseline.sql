CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`category` text NOT NULL,
	`tags` text,
	`date` integer NOT NULL,
	`mileage` integer,
	`description` text,
	`location` text,
	`created_at` integer,
	`updated_at` integer,
	`expense_amount` integer NOT NULL,
	`volume` real,
	`fuel_type` text,
	`missed_fillup` integer DEFAULT false NOT NULL,
	`user_id` text NOT NULL,
	`created_by` text,
	`group_id` text,
	`group_total` integer,
	`split_method` text,
	`source_type` text,
	`source_id` text,
	`client_id` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `expenses_vehicle_date_idx` ON `expenses` (`vehicle_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_vehicle_category_date_idx` ON `expenses` (`vehicle_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_category_date_idx` ON `expenses` (`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_user_date_idx` ON `expenses` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_user_category_date_idx` ON `expenses` (`user_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_group_idx` ON `expenses` (`group_id`);--> statement-breakpoint
CREATE INDEX `expenses_source_idx` ON `expenses` (`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_user_client_idx` ON `expenses` (`user_id`,`client_id`) WHERE "expenses"."client_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `insurance_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`term_id` text,
	`vehicle_id` text,
	`claim_date` integer NOT NULL,
	`claim_type` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'filed' NOT NULL,
	`payout_amount` integer,
	`fault_designation` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`term_id`) REFERENCES `insurance_terms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ic_policy_id_idx` ON `insurance_claims` (`policy_id`);--> statement-breakpoint
CREATE INDEX `ic_policy_status_idx` ON `insurance_claims` (`policy_id`,`status`);--> statement-breakpoint
CREATE INDEX `ic_vehicle_idx` ON `insurance_claims` (`vehicle_id`);--> statement-breakpoint
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
	`deductible_amount` integer,
	`coverage_limit` integer,
	`agent_name` text,
	`agent_phone` text,
	`agent_email` text,
	`total_cost` integer,
	`monthly_cost` integer,
	`premium_frequency` text,
	`payment_amount` integer,
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
CREATE INDEX `pr_pending_idx` ON `photo_refs` (`status`,`created_at`) WHERE "photo_refs"."status" IN ('pending', 'failed') AND "photo_refs"."retry_count" < 3;--> statement-breakpoint
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
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ps_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ps_user_endpoint_idx` ON `push_subscriptions` (`user_id`,`endpoint`);--> statement-breakpoint
CREATE TABLE `reminder_notifications` (
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
);
--> statement-breakpoint
CREATE INDEX `rn_user_unread_idx` ON `reminder_notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE UNIQUE INDEX `rn_reminder_due_idx` ON `reminder_notifications` (`reminder_id`,`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `rn_reminder_odo_idx` ON `reminder_notifications` (`reminder_id`,`due_odometer`) WHERE "reminder_notifications"."due_odometer" IS NOT NULL;--> statement-breakpoint
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
	`trigger_mode` text DEFAULT 'time' NOT NULL,
	`interval_mileage` integer,
	`last_service_odometer` integer,
	`next_due_odometer` integer,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`next_due_date` integer,
	`expense_category` text,
	`expense_tags` text,
	`expense_amount` integer,
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
CREATE INDEX `trips_vehicle_date_idx` ON `trips` (`vehicle_id`,`trip_date`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL,
	`currency_unit` text DEFAULT 'USD' NOT NULL,
	`theme_preference` text DEFAULT 'default' NOT NULL,
	`business_mileage_rate` real DEFAULT 0 NOT NULL,
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
CREATE UNIQUE INDEX `up_auth_identity_idx` ON `user_providers` (`provider_type`,`provider_account_id`) WHERE "user_providers"."domain" = 'auth';--> statement-breakpoint
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
	`original_amount` integer NOT NULL,
	`apr` real,
	`term_months` integer NOT NULL,
	`start_date` integer NOT NULL,
	`payment_amount` integer NOT NULL,
	`payment_frequency` text DEFAULT 'monthly' NOT NULL,
	`payment_day_of_month` integer,
	`payment_day_of_week` integer,
	`residual_value` integer,
	`mileage_limit` integer,
	`excess_mileage_fee` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`end_date` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vf_vehicle_id_idx` ON `vehicle_financing` (`vehicle_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vf_active_vehicle_idx` ON `vehicle_financing` (`vehicle_id`) WHERE "vehicle_financing"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `vehicle_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`shared_with_id` text NOT NULL,
	`level` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_shares_active_idx` ON `vehicle_shares` (`vehicle_id`,`shared_with_id`) WHERE status in ('pending','accepted');--> statement-breakpoint
CREATE INDEX `vehicle_shares_shared_with_idx` ON `vehicle_shares` (`shared_with_id`,`status`);--> statement-breakpoint
CREATE INDEX `vehicle_shares_owner_idx` ON `vehicle_shares` (`owner_id`);--> statement-breakpoint
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
	`purchase_price` integer,
	`purchase_date` integer,
	`unit_preferences` text DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vehicles_user_id_idx` ON `vehicles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_user_license_plate_idx` ON `vehicles` (`user_id`,`license_plate`) WHERE "vehicles"."license_plate" IS NOT NULL;