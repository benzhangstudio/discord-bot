CREATE TABLE `onboarding_progress` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`rules_accepted` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	`completed_at` integer,
	`welcomed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `onboarding_state` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`start_channel_id` text,
	`start_message_id` text
);
