CREATE TABLE `insurance_policy_vehicles` (
	`policy_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	PRIMARY KEY(`policy_id`, `vehicle_id`),
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`current_term_start` integer,
	`current_term_end` integer,
	`terms` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_insurance_policies`("id", "company", "is_active", "current_term_start", "current_term_end", "terms", "notes", "created_at", "updated_at") SELECT "id", "company", "is_active", "current_term_start", "current_term_end", "terms", "notes", "created_at", "updated_at" FROM `insurance_policies`;--> statement-breakpoint
DROP TABLE `insurance_policies`;--> statement-breakpoint
ALTER TABLE `__new_insurance_policies` RENAME TO `insurance_policies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `expenses` ADD `insurance_policy_id` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `insurance_term_id` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `missed_fillup` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `current_insurance_policy_id` text;