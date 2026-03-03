CREATE TABLE `expense_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`split_config` text NOT NULL,
	`category` text NOT NULL,
	`tags` text,
	`date` integer NOT NULL,
	`description` text,
	`total_amount` real NOT NULL,
	`insurance_policy_id` text,
	`insurance_term_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_insurance_policy_vehicles` (
	`policy_id` text NOT NULL,
	`term_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	PRIMARY KEY(`policy_id`, `term_id`, `vehicle_id`),
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_insurance_policy_vehicles`("policy_id", "term_id", "vehicle_id") SELECT "policy_id", "term_id", "vehicle_id" FROM `insurance_policy_vehicles`;--> statement-breakpoint
DROP TABLE `insurance_policy_vehicles`;--> statement-breakpoint
ALTER TABLE `__new_insurance_policy_vehicles` RENAME TO `insurance_policy_vehicles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `expenses` ADD `expense_group_id` text REFERENCES expense_groups(id);
