CREATE TABLE `feature_settings` (
	`guild_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`guild_id`, `feature_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`avatar` text,
	`access_token` text NOT NULL,
	`expires_at` integer NOT NULL
);
