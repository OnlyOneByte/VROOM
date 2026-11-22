CREATE TEMP TABLE `__email_case_check` (`duplicates` integer NOT NULL);--> statement-breakpoint
CREATE TEMP TRIGGER `__email_case_guard` BEFORE INSERT ON `__email_case_check` WHEN NEW.`duplicates` > 0 BEGIN SELECT RAISE(ABORT, 'Migration 0004_lowercase_user_emails stopped: some accounts have emails that differ only by letter case. Nothing was changed. Find them with: SELECT lower(email), group_concat(id) FROM users GROUP BY lower(email) HAVING count(*) > 1; then change or remove one email of each pair by hand and restart.'); END;--> statement-breakpoint
INSERT INTO `__email_case_check` SELECT count(*) FROM (SELECT 1 FROM `users` GROUP BY lower(`email`) HAVING count(*) > 1);--> statement-breakpoint
DROP TRIGGER `__email_case_guard`;--> statement-breakpoint
DROP TABLE `__email_case_check`;--> statement-breakpoint
UPDATE `users` SET `email` = lower(`email`) WHERE `email` <> lower(`email`);
