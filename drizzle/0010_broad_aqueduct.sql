ALTER TABLE `ai_models` ADD `max_input_characters` integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `chapter_naming_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `outline_naming_json` text DEFAULT '{}' NOT NULL;