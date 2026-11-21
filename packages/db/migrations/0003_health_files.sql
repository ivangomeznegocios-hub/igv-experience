CREATE TABLE `health_file_chunks` (
	`file_id` text NOT NULL,
	`idx` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`file_id`, `idx`)
);
--> statement-breakpoint
CREATE TABLE `health_files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`chunks` integer NOT NULL,
	`created_at` integer NOT NULL
);
