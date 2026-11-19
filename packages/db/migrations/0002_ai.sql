CREATE TABLE `ai_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`source` text NOT NULL,
	`tool` text NOT NULL,
	`summary` text NOT NULL,
	`refs` text NOT NULL,
	`undone_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_activity_at_idx` ON `ai_activity` (`at`);--> statement-breakpoint
CREATE TABLE `ai_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text,
	`client_id` text,
	`grant_id` text,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_credentials_hash_idx` ON `ai_credentials` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ai_credentials_kind_idx` ON `ai_credentials` (`kind`);--> statement-breakpoint
CREATE INDEX `ai_credentials_grant_idx` ON `ai_credentials` (`grant_id`);