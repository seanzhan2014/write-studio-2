CREATE TABLE `illustration_history` (
	`id` text PRIMARY KEY NOT NULL,
	`outline_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`style` text DEFAULT '' NOT NULL,
	`model_id` text DEFAULT '' NOT NULL,
	`model_name` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`asset_key` text,
	`mime_type` text,
	`revised_prompt` text,
	`error_message` text,
	`runner_id` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`outline_id`) REFERENCES `outlines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `illustration_history_outline_created_idx` ON `illustration_history` (`outline_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `illustration_history_status_idx` ON `illustration_history` (`status`);