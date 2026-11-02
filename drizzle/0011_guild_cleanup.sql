CREATE TABLE `removed_guilds` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`removed_at` integer NOT NULL
);
--> statement-breakpoint
-- Access tokens are now stored encrypted. Old plain-text logins are cleared, so everyone logs in once more.
DELETE FROM `sessions`;
