ALTER TABLE `articles` ADD `story_settings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `settings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `profile_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `setting_snapshot_json` text;