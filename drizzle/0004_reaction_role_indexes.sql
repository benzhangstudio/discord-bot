CREATE INDEX `reaction_role_entries_role_idx` ON `reaction_role_entries` (`role_id`);--> statement-breakpoint
CREATE INDEX `reaction_role_messages_guild_idx` ON `reaction_role_messages` (`guild_id`);--> statement-breakpoint
CREATE INDEX `reaction_role_messages_channel_idx` ON `reaction_role_messages` (`channel_id`);