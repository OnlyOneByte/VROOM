CREATE TABLE `community_release_members` (
	`scope` text NOT NULL,
	`bucket_key` text NOT NULL,
	`member_tag` text NOT NULL,
	PRIMARY KEY(`scope`, `bucket_key`, `member_tag`)
);
