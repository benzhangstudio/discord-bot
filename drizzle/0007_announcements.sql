CREATE TABLE `announcement_deliveries` (
	`announcement_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`delivered_at` integer NOT NULL,
	PRIMARY KEY(`announcement_id`, `guild_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_deliveries_guild_idx` ON `announcement_deliveries` (`guild_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'sending' NOT NULL
);
