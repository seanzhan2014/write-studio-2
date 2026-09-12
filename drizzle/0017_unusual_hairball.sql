ALTER TABLE `ai_tasks` ADD `review_state_json` text;--> statement-breakpoint
ALTER TABLE `articles` ADD `review_rules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `review_report_json` text;