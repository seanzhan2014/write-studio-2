CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`adapter_kind` text DEFAULT 'openai-compatible' NOT NULL,
	`base_url` text NOT NULL,
	`timeout_ms` integer DEFAULT 120000 NOT NULL,
	`has_secret` integer DEFAULT false NOT NULL,
	`secret` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_models` ADD `provider_id` text REFERENCES ai_providers(id);--> statement-breakpoint
ALTER TABLE `ai_models` ADD `timeout_override_ms` integer;--> statement-breakpoint
CREATE INDEX `ai_models_provider_idx` ON `ai_models` (`provider_id`);
