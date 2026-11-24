CREATE TABLE `community_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`metric` text NOT NULL,
	`bucket_key` text NOT NULL,
	`catalog_model_id` text,
	`model_year` integer,
	`vehicle_type` text,
	`age_band` text,
	`region` text,
	`currency` text,
	`unit` text NOT NULL,
	`n_published` integer NOT NULL,
	`mean` real NOT NULL,
	`p25` real,
	`p50` real NOT NULL,
	`p75` real,
	`computed_at` integer NOT NULL,
	`schema_version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_stats_scope_bucket_idx` ON `community_stats` (`scope`,`bucket_key`);