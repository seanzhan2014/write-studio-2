ALTER TABLE `articles` ADD `ai_generate_settings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `outlines` ADD `generate_options_json` text;