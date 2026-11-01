CREATE TABLE `reaction_role_entries` (
	`message_id` text NOT NULL,
	`emoji_key` text NOT NULL,
	`emoji_display` text NOT NULL,
	`role_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`message_id`, `emoji_key`),
	FOREIGN KEY (`message_id`) REFERENCES `reaction_role_messages`(`message_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reaction_role_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`single_choice` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
