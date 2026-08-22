-- Provider storage was introduced through the runtime compatibility bootstrap
-- before this migration was published. Existing cloud databases may therefore
-- already have this table and the ai_models provider columns. Keep the durable
-- table creation idempotent here; db/runtime.ts adds any missing legacy columns
-- and the provider index after inspecting the live schema.
CREATE TABLE IF NOT EXISTS `ai_providers` (
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
