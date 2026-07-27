ALTER TABLE `ai_models` ADD `secret` text;--> statement-breakpoint
ALTER TABLE `outlines` ADD `title_generation_pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `outlines` SET `title_generation_pending` = true WHERE TRIM(`title`) = '';
