ALTER TABLE `expenses` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_user_client_idx` ON `expenses` (`user_id`,`client_id`) WHERE "expenses"."client_id" IS NOT NULL;