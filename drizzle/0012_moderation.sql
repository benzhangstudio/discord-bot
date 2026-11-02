CREATE TABLE `moderation_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`case_number` integer NOT NULL,
	`action` text NOT NULL,
	`user_id` text NOT NULL,
	`user_tag` text NOT NULL,
	`moderator_id` text NOT NULL,
	`moderator_tag` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`duration_ms` integer,
	`expires_at` integer,
	`active` integer DEFAULT false NOT NULL,
	`auto` integer DEFAULT false NOT NULL,
	`external` integer DEFAULT false NOT NULL,
	`dm_sent` integer DEFAULT false NOT NULL,
	`log_channel_id` text,
	`log_message_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_cases_number_idx` ON `moderation_cases` (`guild_id`,`case_number`);--> statement-breakpoint
CREATE INDEX `moderation_cases_user_idx` ON `moderation_cases` (`guild_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `moderation_cases_expiry_idx` ON `moderation_cases` (`active`,`expires_at`);