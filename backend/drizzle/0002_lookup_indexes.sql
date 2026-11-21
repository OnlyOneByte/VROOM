CREATE INDEX `expenses_created_by_idx` ON `expenses` (`created_by`);--> statement-breakpoint
CREATE INDEX `ic_term_idx` ON `insurance_claims` (`term_id`);--> statement-breakpoint
CREATE INDEX `odometer_user_date_idx` ON `odometer_entries` (`user_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `pr_provider_status_idx` ON `photo_refs` (`provider_id`,`status`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `trips_user_date_idx` ON `trips` (`user_id`,`trip_date`);