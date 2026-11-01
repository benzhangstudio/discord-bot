ALTER TABLE `reaction_role_entries` ADD `label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_entries` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_entries` ADD `style` text DEFAULT 'secondary' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_messages` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_messages` ADD `kind` text DEFAULT 'reactions' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_messages` ADD `mode` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_messages` ADD `content` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reaction_role_messages` ADD `options` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `reaction_role_messages` SET `mode` = 'unique' WHERE `single_choice` = 1;