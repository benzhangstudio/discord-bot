CREATE TABLE `guild_setup` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`completed_at` integer,
	`completed_by` text,
	`welcomed_at` integer
);
