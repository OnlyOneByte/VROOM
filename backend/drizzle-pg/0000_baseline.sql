CREATE TABLE "calendar_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"options" jsonb NOT NULL,
	"last_used_at" bigint,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "community_noise_keys" (
	"scope" text PRIMARY KEY NOT NULL,
	"noise_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_refreshes" (
	"scope" text PRIMARY KEY NOT NULL,
	"refreshed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"metric" text NOT NULL,
	"bucket_key" text NOT NULL,
	"catalog_model_id" text,
	"model_year" bigint,
	"vehicle_type" text,
	"age_band" text,
	"region" text,
	"currency" text,
	"unit" text NOT NULL,
	"n_published" bigint NOT NULL,
	"mean" double precision NOT NULL,
	"computed_at" bigint NOT NULL,
	"schema_version" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_backfills" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"mode" text NOT NULL,
	"entries" jsonb NOT NULL,
	"created_by" text,
	"created_at" bigint,
	"undone_at" bigint
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"category" text NOT NULL,
	"tags" jsonb,
	"date" bigint NOT NULL,
	"mileage" bigint,
	"description" text,
	"location" text,
	"created_at" bigint,
	"updated_at" bigint,
	"expense_amount" bigint NOT NULL,
	"volume" double precision,
	"fuel_type" text,
	"charger_type" text,
	"missed_fillup" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL,
	"created_by" text,
	"paid_by_driver_id" text,
	"group_id" text,
	"group_total" bigint,
	"split_method" text,
	"source_type" text,
	"source_id" text,
	"client_id" text
);
--> statement-breakpoint
CREATE TABLE "insurance_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"term_id" text,
	"vehicle_id" text,
	"claim_date" bigint NOT NULL,
	"claim_type" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'filed' NOT NULL,
	"payout_amount" bigint,
	"fault_designation" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "insurance_term_vehicles" (
	"term_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "insurance_term_vehicles_term_id_vehicle_id_pk" PRIMARY KEY("term_id","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "insurance_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"start_date" bigint NOT NULL,
	"end_date" bigint NOT NULL,
	"policy_number" text,
	"coverage_description" text,
	"deductible_amount" bigint,
	"coverage_limit" bigint,
	"agent_name" text,
	"agent_phone" text,
	"agent_email" text,
	"total_cost" bigint,
	"monthly_cost" bigint,
	"premium_frequency" text,
	"payment_amount" bigint,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "money_unit_migrations" (
	"name" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odometer_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"odometer" bigint NOT NULL,
	"recorded_at" bigint NOT NULL,
	"note" text,
	"source_trip_id" text,
	"driver_id" text,
	"created_by" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"permission" text NOT NULL,
	"effect" text NOT NULL,
	"set_by" text,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "photo_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"photo_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"storage_ref" text NOT NULL,
	"external_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"retry_count" bigint DEFAULT 0 NOT NULL,
	"synced_at" bigint,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"failure_count" bigint DEFAULT 0 NOT NULL,
	"last_success_at" bigint,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "reminder_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"reminder_id" text NOT NULL,
	"user_id" text NOT NULL,
	"due_date" bigint,
	"due_odometer" bigint,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "reminder_vehicles" (
	"reminder_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	CONSTRAINT "reminder_vehicles_reminder_id_vehicle_id_pk" PRIMARY KEY("reminder_id","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"action_mode" text DEFAULT 'automatic' NOT NULL,
	"frequency" text NOT NULL,
	"interval_value" bigint,
	"interval_unit" text,
	"trigger_mode" text DEFAULT 'time' NOT NULL,
	"interval_mileage" bigint,
	"last_service_odometer" bigint,
	"next_due_odometer" bigint,
	"start_date" bigint NOT NULL,
	"end_date" bigint,
	"next_due_date" bigint,
	"expense_category" text,
	"expense_tags" jsonb,
	"expense_amount" bigint,
	"expense_description" text,
	"expense_split_config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" bigint,
	"created_by" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"scope_id" text,
	"granted_by" text,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"color" text,
	"built_in" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "server_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_by" text,
	"created_at" bigint,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"used_by" text,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "server_settings" (
	"id" bigint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "server_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"signup_mode" text DEFAULT 'invite' NOT NULL,
	"allowed_email_domains" text DEFAULT '' NOT NULL,
	"updated_at" bigint,
	"updated_by" text,
	"admin_assigned_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_sync_date" bigint,
	"last_data_change_date" bigint,
	"last_backup_date" bigint
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_odometer" bigint NOT NULL,
	"end_odometer" bigint NOT NULL,
	"purpose" text NOT NULL,
	"trip_date" bigint NOT NULL,
	"start_location" text,
	"end_location" text,
	"note" text,
	"driver_id" text,
	"created_by" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"unit_preferences" jsonb DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}'::jsonb NOT NULL,
	"currency_unit" text DEFAULT 'USD' NOT NULL,
	"theme_preference" text DEFAULT 'default' NOT NULL,
	"business_mileage_rate" double precision DEFAULT 0 NOT NULL,
	"auto_backup_enabled" boolean DEFAULT false NOT NULL,
	"backup_frequency" text DEFAULT 'weekly' NOT NULL,
	"sync_on_inactivity" boolean DEFAULT true NOT NULL,
	"sync_inactivity_minutes" bigint DEFAULT 5 NOT NULL,
	"storage_config" jsonb DEFAULT '{"defaults":{"vehicle_photos":null,"expense_receipts":null,"insurance_docs":null,"odometer_readings":null},"providerCategories":{}}'::jsonb,
	"backup_config" jsonb DEFAULT '{"providers":{}}'::jsonb,
	"provider_defaults" jsonb DEFAULT '{}'::jsonb,
	"community_stats_opt_in" boolean DEFAULT false NOT NULL,
	"community_stats_consented_at" bigint,
	"community_region" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "user_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"provider_type" text NOT NULL,
	"provider_account_id" text,
	"display_name" text NOT NULL,
	"credentials" text NOT NULL,
	"config" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" bigint,
	"last_error_code" text,
	"last_checked_at" bigint,
	"failure_count" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"disabled_at" bigint,
	"pending_approval_at" bigint,
	"created_at" bigint,
	"updated_at" bigint,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"color" text,
	"archived_at" bigint,
	"created_by" text,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "vehicle_financing" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"financing_type" text DEFAULT 'loan' NOT NULL,
	"provider" text NOT NULL,
	"original_amount" bigint NOT NULL,
	"apr" double precision,
	"term_months" bigint NOT NULL,
	"start_date" bigint NOT NULL,
	"payment_amount" bigint NOT NULL,
	"payment_frequency" text DEFAULT 'monthly' NOT NULL,
	"payment_day_of_month" bigint,
	"payment_day_of_week" bigint,
	"residual_value" bigint,
	"mileage_limit" bigint,
	"excess_mileage_fee" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"end_date" bigint,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "vehicle_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"shared_with_id" text,
	"level" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_email" text,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" bigint NOT NULL,
	"vehicle_type" text DEFAULT 'gas' NOT NULL,
	"vehicle_kind" text DEFAULT 'car' NOT NULL,
	"track_fuel" boolean DEFAULT true NOT NULL,
	"track_charging" boolean DEFAULT false NOT NULL,
	"license_plate" text,
	"nickname" text,
	"vin" text,
	"initial_mileage" bigint,
	"purchase_price" bigint,
	"purchase_date" bigint,
	"unit_preferences" jsonb DEFAULT '{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}'::jsonb NOT NULL,
	"catalog_model_id" text,
	"car_share_enabled" boolean DEFAULT false NOT NULL,
	"car_share_rules" jsonb,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_backfills" ADD CONSTRAINT "driver_backfills_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_backfills" ADD CONSTRAINT "driver_backfills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_driver_id_vehicle_drivers_id_fk" FOREIGN KEY ("paid_by_driver_id") REFERENCES "public"."vehicle_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_term_id_insurance_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."insurance_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_term_vehicles" ADD CONSTRAINT "insurance_term_vehicles_term_id_insurance_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."insurance_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_term_vehicles" ADD CONSTRAINT "insurance_term_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_terms" ADD CONSTRAINT "insurance_terms_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_entries" ADD CONSTRAINT "odometer_entries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_entries" ADD CONSTRAINT "odometer_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_entries" ADD CONSTRAINT "odometer_entries_driver_id_vehicle_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."vehicle_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_scope_id_vehicles_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_refs" ADD CONSTRAINT "photo_refs_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_refs" ADD CONSTRAINT "photo_refs_provider_id_user_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."user_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_notifications" ADD CONSTRAINT "reminder_notifications_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_notifications" ADD CONSTRAINT "reminder_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_vehicles" ADD CONSTRAINT "reminder_vehicles_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_vehicles" ADD CONSTRAINT "reminder_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_id_vehicles_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_settings" ADD CONSTRAINT "server_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_vehicle_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."vehicle_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_providers" ADD CONSTRAINT "user_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_drivers" ADD CONSTRAINT "vehicle_drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_drivers" ADD CONSTRAINT "vehicle_drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_drivers" ADD CONSTRAINT "vehicle_drivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_financing" ADD CONSTRAINT "vehicle_financing_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_shared_with_id_users_id_fk" FOREIGN KEY ("shared_with_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cf_user_idx" ON "calendar_feeds" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cf_token_hash_idx" ON "calendar_feeds" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "community_stats_scope_bucket_idx" ON "community_stats" USING btree ("scope","bucket_key");--> statement-breakpoint
CREATE INDEX "driver_backfills_vehicle_idx" ON "driver_backfills" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "expenses_vehicle_date_idx" ON "expenses" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE INDEX "expenses_vehicle_category_date_idx" ON "expenses" USING btree ("vehicle_id","category","date");--> statement-breakpoint
CREATE INDEX "expenses_category_date_idx" ON "expenses" USING btree ("category","date");--> statement-breakpoint
CREATE INDEX "expenses_user_date_idx" ON "expenses" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "expenses_user_category_date_idx" ON "expenses" USING btree ("user_id","category","date");--> statement-breakpoint
CREATE INDEX "expenses_group_idx" ON "expenses" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "expenses_source_idx" ON "expenses" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "expenses_created_by_idx" ON "expenses" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_user_client_idx" ON "expenses" USING btree ("user_id","client_id") WHERE "expenses"."client_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ic_policy_id_idx" ON "insurance_claims" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "ic_policy_status_idx" ON "insurance_claims" USING btree ("policy_id","status");--> statement-breakpoint
CREATE INDEX "ic_vehicle_idx" ON "insurance_claims" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "ic_term_idx" ON "insurance_claims" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "insurance_policies_user_id_idx" ON "insurance_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "itv_vehicle_idx" ON "insurance_term_vehicles" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "itv_position_idx" ON "insurance_term_vehicles" USING btree ("position");--> statement-breakpoint
CREATE INDEX "it_policy_id_idx" ON "insurance_terms" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "it_policy_end_date_idx" ON "insurance_terms" USING btree ("policy_id","end_date");--> statement-breakpoint
CREATE INDEX "odometer_vehicle_date_idx" ON "odometer_entries" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
CREATE INDEX "odometer_user_date_idx" ON "odometer_entries" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "po_user_scope_permission_idx" ON "permission_overrides" USING btree ("user_id","scope","scope_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "po_server_user_permission_idx" ON "permission_overrides" USING btree ("user_id","scope","permission") WHERE scope_id is null;--> statement-breakpoint
CREATE INDEX "po_scope_idx" ON "permission_overrides" USING btree ("scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_photo_provider_idx" ON "photo_refs" USING btree ("photo_id","provider_id");--> statement-breakpoint
CREATE INDEX "pr_provider_status_idx" ON "photo_refs" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "pr_pending_idx" ON "photo_refs" USING btree ("status","created_at") WHERE "photo_refs"."status" IN ('pending', 'failed') AND "photo_refs"."retry_count" < 3;--> statement-breakpoint
CREATE INDEX "photos_entity_idx" ON "photos" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "photos_user_entity_type_idx" ON "photos" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE INDEX "ps_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ps_user_endpoint_idx" ON "push_subscriptions" USING btree ("user_id","endpoint");--> statement-breakpoint
CREATE INDEX "rn_user_unread_idx" ON "reminder_notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "rn_reminder_due_idx" ON "reminder_notifications" USING btree ("reminder_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "rn_reminder_odo_idx" ON "reminder_notifications" USING btree ("reminder_id","due_odometer") WHERE "reminder_notifications"."due_odometer" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rv_vehicle_idx" ON "reminder_vehicles" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "reminders_user_active_due_idx" ON "reminders" USING btree ("user_id","is_active","next_due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ra_user_role_scope_idx" ON "role_assignments" USING btree ("user_id","role_id","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ra_server_user_role_idx" ON "role_assignments" USING btree ("user_id","role_id") WHERE scope_id is null;--> statement-breakpoint
CREATE INDEX "ra_role_idx" ON "role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "ra_scope_idx" ON "role_assignments" USING btree ("scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_scope_key_idx" ON "roles" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "roles_owner_idx" ON "roles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "server_invites_email_idx" ON "server_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trips_vehicle_date_idx" ON "trips" USING btree ("vehicle_id","trip_date");--> statement-breakpoint
CREATE INDEX "trips_user_date_idx" ON "trips" USING btree ("user_id","trip_date");--> statement-breakpoint
CREATE INDEX "up_user_domain_idx" ON "user_providers" USING btree ("user_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "up_auth_identity_idx" ON "user_providers" USING btree ("provider_type","provider_account_id") WHERE "user_providers"."domain" = 'auth';--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vehicle_drivers_vehicle_idx" ON "vehicle_drivers" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_drivers_vehicle_user_idx" ON "vehicle_drivers" USING btree ("vehicle_id","user_id") WHERE "vehicle_drivers"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vf_vehicle_id_idx" ON "vehicle_financing" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vf_active_vehicle_idx" ON "vehicle_financing" USING btree ("vehicle_id") WHERE "vehicle_financing"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_shares_active_idx" ON "vehicle_shares" USING btree ("vehicle_id","shared_with_id") WHERE status in ('pending','accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_shares_pending_invite_idx" ON "vehicle_shares" USING btree ("vehicle_id","invited_email") WHERE shared_with_id is null and status = 'pending';--> statement-breakpoint
CREATE INDEX "vehicle_shares_shared_with_idx" ON "vehicle_shares" USING btree ("shared_with_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_shares_owner_idx" ON "vehicle_shares" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "vehicles_user_id_idx" ON "vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_user_license_plate_idx" ON "vehicles" USING btree ("user_id","license_plate") WHERE "vehicles"."license_plate" IS NOT NULL;