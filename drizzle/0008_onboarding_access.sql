ALTER TABLE `onboarding_state` ADD `private_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `onboarding_state` ADD `managed_channels` text DEFAULT '{}' NOT NULL;