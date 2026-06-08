CREATE TABLE `insurance_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`term_id` text,
	`vehicle_id` text,
	`claim_date` integer NOT NULL,
	`claim_type` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'filed' NOT NULL,
	`payout_amount` real,
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
CREATE INDEX `ic_vehicle_idx` ON `insurance_claims` (`vehicle_id`);