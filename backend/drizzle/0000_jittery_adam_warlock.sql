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
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`company` text NOT NULL,
	`policy_number` text,
	`total_cost` real NOT NULL,
	`term_length_months` integer NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL,
	`monthly_cost` real NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`distance_unit` text DEFAULT 'miles' NOT NULL,
	`volume_unit` text DEFAULT 'gallons_us' NOT NULL,
	`charge_unit` text DEFAULT 'kwh' NOT NULL,
	`currency_unit` text DEFAULT 'USD' NOT NULL,
	`auto_backup_enabled` integer DEFAULT false NOT NULL,
	`backup_frequency` text DEFAULT 'weekly' NOT NULL,
	`last_backup_date` integer,
	`google_drive_backup_enabled` integer DEFAULT false NOT NULL,
	`google_drive_backup_folder_id` text,
	`google_drive_backup_retention_count` integer DEFAULT 10 NOT NULL,
	`google_sheets_sync_enabled` integer DEFAULT false NOT NULL,
	`google_sheets_spreadsheet_id` text,
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
	`google_refresh_token` text,
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
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`year` integer NOT NULL,
	`vehicle_type` text DEFAULT 'gas' NOT NULL,
	`license_plate` text,
	`nickname` text,
	`vin` text,
	`initial_mileage` integer,
	`purchase_price` real,
	`purchase_date` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
