CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`sort` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `entities_updated_at_idx` ON `entities` (`updated_at`);--> statement-breakpoint
CREATE INDEX `entities_module_idx` ON `entities` (`module`,`kind`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`local_date` text NOT NULL,
	`payload` text NOT NULL,
	`voided_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_updated_at_idx` ON `events` (`updated_at`);--> statement-breakpoint
CREATE INDEX `events_local_date_idx` ON `events` (`local_date`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);