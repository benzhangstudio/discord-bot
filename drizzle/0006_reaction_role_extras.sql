CREATE TABLE `reaction_role_stats` (
	`message_id` text NOT NULL,
	`role_id` text NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	PRIMARY KEY(`message_id`, `role_id`)
);
--> statement-breakpoint
CREATE TABLE `reaction_role_timers` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `role_id`)
);
--> statement-breakpoint
CREATE INDEX `reaction_role_timers_due_idx` ON `reaction_role_timers` (`expires_at`);--> statement-breakpoint
ALTER TABLE `reaction_role_messages` ADD `external` integer DEFAULT false NOT NULL;