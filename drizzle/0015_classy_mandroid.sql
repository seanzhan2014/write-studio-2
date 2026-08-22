CREATE TABLE `sync_change_log` (
	`database_version` integer PRIMARY KEY NOT NULL,
	`change_json` text NOT NULL,
	`created_at` text NOT NULL
);
