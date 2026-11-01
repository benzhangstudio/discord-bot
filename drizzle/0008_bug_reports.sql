CREATE TABLE `bug_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`guild_name` text NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`summary` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bug_reports_resolved_idx` ON `bug_reports` (`resolved`);