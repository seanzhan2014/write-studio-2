ALTER TABLE `chapters` ADD `name_versions_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `default_name_version_id` text;--> statement-breakpoint
ALTER TABLE `outlines` ADD `name_versions_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `outlines` ADD `default_name_version_id` text;