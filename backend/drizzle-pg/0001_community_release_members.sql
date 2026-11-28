CREATE TABLE "community_release_members" (
	"scope" text NOT NULL,
	"bucket_key" text NOT NULL,
	"member_tag" text NOT NULL,
	CONSTRAINT "community_release_members_scope_bucket_key_member_tag_pk" PRIMARY KEY("scope","bucket_key","member_tag")
);
