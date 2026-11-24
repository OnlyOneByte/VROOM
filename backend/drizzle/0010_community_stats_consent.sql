ALTER TABLE `user_preferences` ADD `community_stats_opt_in` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `community_stats_consented_at` integer;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `community_region` text;