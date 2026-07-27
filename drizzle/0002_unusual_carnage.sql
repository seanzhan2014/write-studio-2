ALTER TABLE `characters` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `characters` SET `description` = RTRIM(
  CASE WHEN TRIM(`role`) <> '' THEN '身份：' || TRIM(`role`) || CHAR(10) ELSE '' END ||
  CASE WHEN TRIM(`appearance`) <> '' THEN '外貌：' || TRIM(`appearance`) || CHAR(10) ELSE '' END ||
  CASE WHEN TRIM(`personality`) <> '' THEN '性格：' || TRIM(`personality`) || CHAR(10) ELSE '' END ||
  CASE WHEN TRIM(`abilities`) <> '' THEN '能力：' || TRIM(`abilities`) || CHAR(10) ELSE '' END ||
  CASE WHEN TRIM(`background`) <> '' THEN '背景：' || TRIM(`background`) || CHAR(10) ELSE '' END,
  CHAR(10)
);--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `role`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `appearance`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `personality`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `abilities`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `background`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `color`;
