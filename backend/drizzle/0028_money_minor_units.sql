CREATE TABLE IF NOT EXISTS `money_unit_migrations` (
	`name` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TEMP TABLE `__money_zero_users` AS
SELECT `user_id` FROM `user_preferences`
WHERE `currency_unit` IN (
	'AFN', 'ALL', 'BIF', 'CLP', 'COP', 'DJF', 'GNF', 'HUF', 'IDR', 'IRR', 'ISK',
	'JPY', 'KMF', 'KPW', 'KRW', 'LAK', 'LBP', 'MGA', 'MMK', 'PKR', 'PYG', 'RWF',
	'SOS', 'SYP', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'YER'
)
AND NOT EXISTS (SELECT 1 FROM `money_unit_migrations` WHERE `name` = '0028_money_minor_units');
--> statement-breakpoint
CREATE TEMP TABLE `__money_legs` AS
SELECT `id`, `floor_part` + CASE
	WHEN ROW_NUMBER() OVER (PARTITION BY `group_id` ORDER BY `remainder` DESC, `id`)
		<= `new_total` - SUM(`floor_part`) OVER (PARTITION BY `group_id`) THEN 1
	ELSE 0
END AS `amount`
FROM (
	SELECT `id`, `group_id`,
		CASE WHEN `expense_amount` >= 0 THEN `expense_amount` / 100
			ELSE -((99 - `expense_amount`) / 100) END AS `floor_part`,
		((`expense_amount` % 100) + 100) % 100 AS `remainder`,
		CASE WHEN `group_total` >= 0 THEN (`group_total` + 50) / 100
			ELSE -((50 - `group_total`) / 100) END AS `new_total`
	FROM `expenses`
	WHERE `group_id` IS NOT NULL AND `group_total` IS NOT NULL
		AND `user_id` IN (SELECT `user_id` FROM `__money_zero_users`)
) AS `legs`;
--> statement-breakpoint
CREATE TEMP TABLE `__money_allocations` AS
SELECT `reminder_id`, `idx`, `floor_part` + CASE
	WHEN ROW_NUMBER() OVER (PARTITION BY `reminder_id` ORDER BY `remainder` DESC, `idx`)
		<= `new_total` - SUM(`floor_part`) OVER (PARTITION BY `reminder_id`) THEN 1
	ELSE 0
END AS `amount`
FROM (
	SELECT `reminder_id`, `idx`,
		CASE WHEN `cents` >= 0 THEN `cents` / 100 ELSE -((99 - `cents`) / 100) END AS `floor_part`,
		((`cents` % 100) + 100) % 100 AS `remainder`,
		CASE WHEN `total` >= 0 THEN (`total` + 50) / 100 ELSE -((50 - `total`) / 100) END AS `new_total`
	FROM (
		SELECT `r`.`id` AS `reminder_id`, CAST(`a`.`key` AS INTEGER) AS `idx`,
			CAST(json_extract(`a`.`value`, '$.amount') AS INTEGER) AS `cents`,
			COALESCE(`r`.`expense_amount`, SUM(CAST(json_extract(`a`.`value`, '$.amount') AS INTEGER))
				OVER (PARTITION BY `r`.`id`)) AS `total`
		FROM `reminders` AS `r`,
			json_each(
				CASE WHEN json_valid(`r`.`expense_split_config`)
					AND json_extract(`r`.`expense_split_config`, '$.method') = 'absolute'
					THEN `r`.`expense_split_config` END,
				'$.allocations'
			) AS `a`
		WHERE `r`.`user_id` IN (SELECT `user_id` FROM `__money_zero_users`)
	) AS `allocations`
) AS `parts`;
--> statement-breakpoint
UPDATE `expenses` SET
	`expense_amount` = COALESCE(
		(SELECT `amount` FROM `__money_legs` WHERE `__money_legs`.`id` = `expenses`.`id`),
		CASE WHEN `expense_amount` >= 0 THEN (`expense_amount` + 50) / 100
			ELSE -((50 - `expense_amount`) / 100) END
	),
	`group_total` = CASE WHEN `group_total` >= 0 THEN (`group_total` + 50) / 100
		ELSE -((50 - `group_total`) / 100) END
WHERE `user_id` IN (SELECT `user_id` FROM `__money_zero_users`);
--> statement-breakpoint
UPDATE `vehicles` SET
	`purchase_price` = CASE WHEN `purchase_price` >= 0 THEN (`purchase_price` + 50) / 100
		ELSE -((50 - `purchase_price`) / 100) END
WHERE `user_id` IN (SELECT `user_id` FROM `__money_zero_users`);
--> statement-breakpoint
UPDATE `vehicle_financing` SET
	`original_amount` = CASE WHEN `original_amount` >= 0 THEN (`original_amount` + 50) / 100
		ELSE -((50 - `original_amount`) / 100) END,
	`payment_amount` = CASE WHEN `payment_amount` >= 0 THEN (`payment_amount` + 50) / 100
		ELSE -((50 - `payment_amount`) / 100) END,
	`residual_value` = CASE WHEN `residual_value` >= 0 THEN (`residual_value` + 50) / 100
		ELSE -((50 - `residual_value`) / 100) END,
	`excess_mileage_fee` = CASE WHEN `excess_mileage_fee` >= 0 THEN (`excess_mileage_fee` + 50) / 100
		ELSE -((50 - `excess_mileage_fee`) / 100) END
WHERE `vehicle_id` IN (
	SELECT `id` FROM `vehicles` WHERE `user_id` IN (SELECT `user_id` FROM `__money_zero_users`)
);
--> statement-breakpoint
UPDATE `insurance_terms` SET
	`deductible_amount` = CASE WHEN `deductible_amount` >= 0 THEN (`deductible_amount` + 50) / 100
		ELSE -((50 - `deductible_amount`) / 100) END,
	`coverage_limit` = CASE WHEN `coverage_limit` >= 0 THEN (`coverage_limit` + 50) / 100
		ELSE -((50 - `coverage_limit`) / 100) END,
	`total_cost` = CASE WHEN `total_cost` >= 0 THEN (`total_cost` + 50) / 100
		ELSE -((50 - `total_cost`) / 100) END,
	`monthly_cost` = CASE WHEN `monthly_cost` >= 0 THEN (`monthly_cost` + 50) / 100
		ELSE -((50 - `monthly_cost`) / 100) END,
	`payment_amount` = CASE WHEN `payment_amount` >= 0 THEN (`payment_amount` + 50) / 100
		ELSE -((50 - `payment_amount`) / 100) END
WHERE `policy_id` IN (
	SELECT `id` FROM `insurance_policies`
	WHERE `user_id` IN (SELECT `user_id` FROM `__money_zero_users`)
);
--> statement-breakpoint
UPDATE `insurance_claims` SET
	`payout_amount` = CASE WHEN `payout_amount` >= 0 THEN (`payout_amount` + 50) / 100
		ELSE -((50 - `payout_amount`) / 100) END
WHERE `policy_id` IN (
	SELECT `id` FROM `insurance_policies`
	WHERE `user_id` IN (SELECT `user_id` FROM `__money_zero_users`)
);
--> statement-breakpoint
UPDATE `reminders` SET
	`expense_amount` = CASE WHEN `expense_amount` >= 0 THEN (`expense_amount` + 50) / 100
		ELSE -((50 - `expense_amount`) / 100) END
WHERE `user_id` IN (SELECT `user_id` FROM `__money_zero_users`);
--> statement-breakpoint
UPDATE `reminders` SET
	`expense_split_config` = json_set(`expense_split_config`, '$.allocations', json((
		SELECT json_group_array(json_set(`a`.`value`, '$.amount', `m`.`amount`) ORDER BY `m`.`idx`)
		FROM json_each(`reminders`.`expense_split_config`, '$.allocations') AS `a`
		JOIN `__money_allocations` AS `m`
			ON `m`.`reminder_id` = `reminders`.`id` AND `m`.`idx` = `a`.`key`
	)))
WHERE `id` IN (SELECT `reminder_id` FROM `__money_allocations`);
--> statement-breakpoint
INSERT INTO `money_unit_migrations` (`name`)
SELECT '0028_money_minor_units'
WHERE NOT EXISTS (SELECT 1 FROM `money_unit_migrations` WHERE `name` = '0028_money_minor_units');
--> statement-breakpoint
DROP TABLE `__money_allocations`;
--> statement-breakpoint
DROP TABLE `__money_legs`;
--> statement-breakpoint
DROP TABLE `__money_zero_users`;
