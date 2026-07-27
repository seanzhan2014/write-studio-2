DROP INDEX `chat_sessions_outline_id_unique`;--> statement-breakpoint
CREATE INDEX `chat_sessions_outline_updated_idx` ON `chat_sessions` (`outline_id`,`updated_at`);