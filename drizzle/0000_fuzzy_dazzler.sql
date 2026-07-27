CREATE TABLE `ai_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`model_id` text NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`temperature` real,
	`max_output` integer,
	`timeout_ms` integer NOT NULL,
	`has_secret` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`outline_id` text NOT NULL,
	`target` text NOT NULL,
	`instruction` text NOT NULL,
	`model_id` text NOT NULL,
	`context_options_json` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`result_text` text,
	`result_version_id` text,
	`error_code` text,
	`error_message` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outline_id`) REFERENCES `outlines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tasks_idempotency_key_unique` ON `ai_tasks` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_tasks_status_created_idx` ON `ai_tasks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_tasks_outline_created_idx` ON `ai_tasks` (`outline_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_tasks_article_created_idx` ON `ai_tasks` (`article_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`article_type` text DEFAULT '' NOT NULL,
	`style` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_opened_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `articles_last_opened_idx` ON `articles` (`last_opened_at`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_article_position_unique` ON `chapters` (`article_id`,`position`);--> statement-breakpoint
CREATE INDEX `chapters_article_archived_position_idx` ON `chapters` (`article_id`,`archived`,`position`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`appearance` text DEFAULT '' NOT NULL,
	`personality` text DEFAULT '' NOT NULL,
	`abilities` text DEFAULT '' NOT NULL,
	`background` text DEFAULT '' NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_article_name_unique` ON `characters` (`article_id`,`name`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_session_order_unique` ON `chat_messages` (`session_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`outline_id` text NOT NULL,
	`draft` text DEFAULT '' NOT NULL,
	`model_id` text,
	`context_options_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outline_id`) REFERENCES `outlines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_outline_id_unique` ON `chat_sessions` (`outline_id`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`outline_id` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`source_version_id` text,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`outline_id`) REFERENCES `outlines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_outline_id_unique` ON `contents` (`outline_id`);--> statement-breakpoint
CREATE TABLE `outlines` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`position` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`state` text DEFAULT 'saved' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outlines_chapter_position_unique` ON `outlines` (`chapter_id`,`position`);--> statement-breakpoint
CREATE INDEX `outlines_article_chapter_archived_position_idx` ON `outlines` (`article_id`,`chapter_id`,`archived`,`position`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`character_low_id` text NOT NULL,
	`character_high_id` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_low_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_high_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationships_article_pair_unique` ON `relationships` (`article_id`,`character_low_id`,`character_high_id`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`outline_id` text NOT NULL,
	`name` text NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`model_id` text,
	`prompt` text,
	`task_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`outline_id`) REFERENCES `outlines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `versions_outline_created_idx` ON `versions` (`outline_id`,`created_at`);