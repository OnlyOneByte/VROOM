CREATE TABLE `permission_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`permission` text NOT NULL,
	`effect` text NOT NULL,
	`set_by` text,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_user_scope_permission_idx` ON `permission_overrides` (`user_id`,`scope`,`scope_id`,`permission`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_server_user_permission_idx` ON `permission_overrides` (`user_id`,`scope`,`permission`) WHERE scope_id is null;--> statement-breakpoint
CREATE INDEX `po_scope_idx` ON `permission_overrides` (`scope_id`);--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`scope_id` text,
	`granted_by` text,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ra_user_role_scope_idx` ON `role_assignments` (`user_id`,`role_id`,`scope_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ra_server_user_role_idx` ON `role_assignments` (`user_id`,`role_id`) WHERE scope_id is null;--> statement-breakpoint
CREATE INDEX `ra_role_idx` ON `role_assignments` (`role_id`);--> statement-breakpoint
CREATE INDEX `ra_scope_idx` ON `role_assignments` (`scope_id`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`key` text,
	`name` text NOT NULL,
	`color` text,
	`built_in` integer DEFAULT false NOT NULL,
	`owner_user_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_scope_key_idx` ON `roles` (`scope`,`key`);--> statement-breakpoint
CREATE INDEX `roles_owner_idx` ON `roles` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` integer;