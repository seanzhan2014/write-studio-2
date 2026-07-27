ALTER TABLE `ai_tasks` ADD `phase` text;
--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `last_progress_at` text;
--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `received_characters` integer;
--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `timeout_ms` integer;
--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `runner_id` text;
--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `lease_until` text;
