CREATE INDEX `expenses_vehicle_date_idx` ON `expenses` (`vehicle_id`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_vehicle_category_date_idx` ON `expenses` (`vehicle_id`,`category`,`date`);--> statement-breakpoint
CREATE INDEX `expenses_group_idx` ON `expenses` (`expense_group_id`);--> statement-breakpoint
CREATE INDEX `expenses_category_date_idx` ON `expenses` (`category`,`date`);--> statement-breakpoint
CREATE INDEX `vehicles_user_id_idx` ON `vehicles` (`user_id`);