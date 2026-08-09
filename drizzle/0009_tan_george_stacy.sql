CREATE TABLE `excellent_fragments` (
	`id` text PRIMARY KEY NOT NULL,
	`outline_id` text NOT NULL,
	`version_id` text,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`selected_text` text NOT NULL,
	`prefix_context` text DEFAULT '' NOT NULL,
	`suffix_context` text DEFAULT '' NOT NULL,
	`source_hash` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`outline_id`) REFERENCES `outlines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `excellent_fragments_outline_idx` ON `excellent_fragments` (`outline_id`);--> statement-breakpoint
CREATE INDEX `excellent_fragments_version_idx` ON `excellent_fragments` (`version_id`);