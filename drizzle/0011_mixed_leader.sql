CREATE TABLE `chat_request_claims` (
	`request_id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_request_claims_expires_idx` ON `chat_request_claims` (`expires_at`);
