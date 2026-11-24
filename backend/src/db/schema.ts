import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { BackupConfig, ProviderDefaults, StorageConfig, UnitPreferences } from '../types';
import { DEFAULT_BACKUP_CONFIG, DEFAULT_STORAGE_CONFIG, DEFAULT_UNIT_PREFERENCES } from '../types';
import type { SplitConfig } from './types';

export const users = sqliteTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    disabledAt: integer('disabled_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    emailLowerIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`),
  })
);

export const vehicles = sqliteTable(
  'vehicles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    vehicleType: text('vehicle_type').notNull().default('gas'),
    vehicleKind: text('vehicle_kind').notNull().default('car'),
    trackFuel: integer('track_fuel', { mode: 'boolean' }).notNull().default(true),
    trackCharging: integer('track_charging', { mode: 'boolean' }).notNull().default(false),
    licensePlate: text('license_plate'),
    nickname: text('nickname'),
    vin: text('vin'),
    initialMileage: integer('initial_mileage'),
    purchasePrice: integer('purchase_price'),
    purchaseDate: integer('purchase_date', { mode: 'timestamp' }),
    unitPreferences: text('unit_preferences', { mode: 'json' })
      .$type<UnitPreferences>()
      .notNull()
      .default(DEFAULT_UNIT_PREFERENCES),
    catalogModelId: text('catalog_model_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index('vehicles_user_id_idx').on(table.userId),
    userLicensePlateIdx: uniqueIndex('vehicles_user_license_plate_idx')
      .on(table.userId, table.licensePlate)
      .where(sql`${table.licensePlate} IS NOT NULL`),
  })
);

export const vehicleFinancing = sqliteTable(
  'vehicle_financing',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    financingType: text('financing_type').notNull().default('loan'),
    provider: text('provider').notNull(),
    originalAmount: integer('original_amount').notNull(),
    apr: real('apr'),
    termMonths: integer('term_months').notNull(),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    paymentAmount: integer('payment_amount').notNull(),
    paymentFrequency: text('payment_frequency').notNull().default('monthly'),
    paymentDayOfMonth: integer('payment_day_of_month'),
    paymentDayOfWeek: integer('payment_day_of_week'),
    residualValue: integer('residual_value'),
    mileageLimit: integer('mileage_limit'),
    excessMileageFee: integer('excess_mileage_fee'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    endDate: integer('end_date', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleIdIdx: index('vf_vehicle_id_idx').on(table.vehicleId),
    activeVehicleIdx: uniqueIndex('vf_active_vehicle_idx')
      .on(table.vehicleId)
      .where(sql`${table.isActive} = 1`),
  })
);

export const insurancePolicies = sqliteTable(
  'insurance_policies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    company: text('company').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index('insurance_policies_user_id_idx').on(table.userId),
  })
);

export const insuranceTerms = sqliteTable(
  'insurance_terms',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    policyId: text('policy_id')
      .notNull()
      .references(() => insurancePolicies.id, { onDelete: 'cascade' }),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    endDate: integer('end_date', { mode: 'timestamp' }).notNull(),
    policyNumber: text('policy_number'),
    coverageDescription: text('coverage_description'),
    deductibleAmount: integer('deductible_amount'),
    coverageLimit: integer('coverage_limit'),
    agentName: text('agent_name'),
    agentPhone: text('agent_phone'),
    agentEmail: text('agent_email'),
    totalCost: integer('total_cost'),
    monthlyCost: integer('monthly_cost'),
    premiumFrequency: text('premium_frequency'),
    paymentAmount: integer('payment_amount'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    policyIdIdx: index('it_policy_id_idx').on(table.policyId),
    policyEndDateIdx: index('it_policy_end_date_idx').on(table.policyId, table.endDate),
  })
);

export const insuranceTermVehicles = sqliteTable(
  'insurance_term_vehicles',
  {
    termId: text('term_id')
      .notNull()
      .references(() => insuranceTerms.id, { onDelete: 'cascade' }),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.termId, table.vehicleId] }),
    vehicleIdx: index('itv_vehicle_idx').on(table.vehicleId),
  })
);

export const insuranceTermVehicleSelectionOrder = sql`${insuranceTermVehicles}.rowid`;

export const insuranceClaims = sqliteTable(
  'insurance_claims',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    policyId: text('policy_id')
      .notNull()
      .references(() => insurancePolicies.id, { onDelete: 'cascade' }),
    termId: text('term_id').references(() => insuranceTerms.id, { onDelete: 'set null' }),
    vehicleId: text('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    claimDate: integer('claim_date', { mode: 'timestamp' }).notNull(),
    claimType: text('claim_type').notNull(),
    description: text('description'),
    status: text('status').notNull().default('filed'),
    payoutAmount: integer('payout_amount'),
    faultDesignation: text('fault_designation'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    policyIdIdx: index('ic_policy_id_idx').on(table.policyId),
    policyStatusIdx: index('ic_policy_status_idx').on(table.policyId, table.status),
    vehicleIdx: index('ic_vehicle_idx').on(table.vehicleId),
    termIdx: index('ic_term_idx').on(table.termId),
  })
);

export type SplitMethod = 'even' | 'absolute' | 'percentage';

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    mileage: integer('mileage'),
    description: text('description'),
    location: text('location'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    expenseAmount: integer('expense_amount').notNull(),
    volume: real('volume'),
    fuelType: text('fuel_type'),
    missedFillup: integer('missed_fillup', { mode: 'boolean' }).notNull().default(false),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    groupId: text('group_id'),
    groupTotal: integer('group_total'),
    splitMethod: text('split_method'),
    sourceType: text('source_type'),
    sourceId: text('source_id'),
    clientId: text('client_id'),
  },
  (table) => ({
    vehicleDateIdx: index('expenses_vehicle_date_idx').on(table.vehicleId, table.date),
    vehicleCategoryDateIdx: index('expenses_vehicle_category_date_idx').on(
      table.vehicleId,
      table.category,
      table.date
    ),
    categoryDateIdx: index('expenses_category_date_idx').on(table.category, table.date),
    userDateIdx: index('expenses_user_date_idx').on(table.userId, table.date),
    userCategoryDateIdx: index('expenses_user_category_date_idx').on(
      table.userId,
      table.category,
      table.date
    ),
    groupIdx: index('expenses_group_idx').on(table.groupId),
    sourceIdx: index('expenses_source_idx').on(table.sourceType, table.sourceId),
    createdByIdx: index('expenses_created_by_idx').on(table.createdBy),
    userClientIdx: uniqueIndex('expenses_user_client_idx')
      .on(table.userId, table.clientId)
      .where(sql`${table.clientId} IS NOT NULL`),
  })
);

export const userProviders = sqliteTable(
  'user_providers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    providerType: text('provider_type').notNull(),
    providerAccountId: text('provider_account_id'),
    displayName: text('display_name').notNull(),
    credentials: text('credentials').notNull(),
    config: text('config', { mode: 'json' }),
    status: text('status').notNull().default('active'),
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
    lastErrorCode: text('last_error_code'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
    failureCount: integer('failure_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userDomainIdx: index('up_user_domain_idx').on(table.userId, table.domain),
    authIdentityIdx: uniqueIndex('up_auth_identity_idx')
      .on(table.providerType, table.providerAccountId)
      .where(sql`${table.domain} = 'auth'`),
  })
);

export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  unitPreferences: text('unit_preferences', { mode: 'json' })
    .$type<UnitPreferences>()
    .notNull()
    .default(DEFAULT_UNIT_PREFERENCES),
  currencyUnit: text('currency_unit').notNull().default('USD'),
  themePreference: text('theme_preference').notNull().default('default'),
  businessMileageRate: real('business_mileage_rate').notNull().default(0),
  autoBackupEnabled: integer('auto_backup_enabled', { mode: 'boolean' }).notNull().default(false),
  backupFrequency: text('backup_frequency').notNull().default('weekly'),
  syncOnInactivity: integer('sync_on_inactivity', { mode: 'boolean' }).notNull().default(true),
  syncInactivityMinutes: integer('sync_inactivity_minutes').notNull().default(5),
  storageConfig: text('storage_config', { mode: 'json' })
    .$type<StorageConfig>()
    .default(DEFAULT_STORAGE_CONFIG),
  backupConfig: text('backup_config', { mode: 'json' })
    .$type<BackupConfig>()
    .default(DEFAULT_BACKUP_CONFIG),
  providerDefaults: text('provider_defaults', { mode: 'json' })
    .$type<ProviderDefaults>()
    .default({}),
  communityStatsOptIn: integer('community_stats_opt_in', { mode: 'boolean' })
    .notNull()
    .default(false),
  communityStatsConsentedAt: integer('community_stats_consented_at', { mode: 'timestamp' }),
  communityRegion: text('community_region'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const syncState = sqliteTable('sync_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastSyncDate: integer('last_sync_date', { mode: 'timestamp' }),
  lastDataChangeDate: integer('last_data_change_date', { mode: 'timestamp' }),
  lastBackupDate: integer('last_backup_date', { mode: 'timestamp' }),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').notNull().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),
  })
);

export const odometerEntries = sqliteTable(
  'odometer_entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    odometer: integer('odometer').notNull(),
    recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
    note: text('note'),
    sourceTripId: text('source_trip_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleDateIdx: index('odometer_vehicle_date_idx').on(table.vehicleId, table.recordedAt),
    userDateIdx: index('odometer_user_date_idx').on(table.userId, table.recordedAt),
  })
);

export const trips = sqliteTable(
  'trips',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startOdometer: integer('start_odometer').notNull(),
    endOdometer: integer('end_odometer').notNull(),
    purpose: text('purpose').notNull(),
    tripDate: integer('trip_date', { mode: 'timestamp' }).notNull(),
    startLocation: text('start_location'),
    endLocation: text('end_location'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleDateIdx: index('trips_vehicle_date_idx').on(table.vehicleId, table.tripDate),
    userDateIdx: index('trips_user_date_idx').on(table.userId, table.tripDate),
  })
);

export const photos = sqliteTable(
  'photos',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    isCover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    entityIdx: index('photos_entity_idx').on(table.entityType, table.entityId),
    userEntityTypeIdx: index('photos_user_entity_type_idx').on(table.userId, table.entityType),
  })
);

export const photoRefs = sqliteTable(
  'photo_refs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    photoId: text('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => userProviders.id, { onDelete: 'cascade' }),
    storageRef: text('storage_ref').notNull(),
    externalUrl: text('external_url'),
    status: text('status', { enum: ['pending', 'active', 'failed'] })
      .notNull()
      .default('pending'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    syncedAt: integer('synced_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    photoProviderIdx: uniqueIndex('pr_photo_provider_idx').on(table.photoId, table.providerId),
    providerStatusIdx: index('pr_provider_status_idx').on(table.providerId, table.status),
    pendingIdx: index('pr_pending_idx')
      .on(table.status, table.createdAt)
      .where(sql`${table.status} IN ('pending', 'failed') AND ${table.retryCount} < 3`),
  })
);

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull(),
    actionMode: text('action_mode').notNull().default('automatic'),
    frequency: text('frequency').notNull(),
    intervalValue: integer('interval_value'),
    intervalUnit: text('interval_unit'),
    triggerMode: text('trigger_mode').notNull().default('time'),
    intervalMileage: integer('interval_mileage'),
    lastServiceOdometer: integer('last_service_odometer'),
    nextDueOdometer: integer('next_due_odometer'),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    endDate: integer('end_date', { mode: 'timestamp' }),
    // PRAGMA foreign_keys is a no-op inside the migrator's transaction, so table rebuilds must go child-first.
    nextDueDate: integer('next_due_date', { mode: 'timestamp' }),
    expenseCategory: text('expense_category'),
    expenseTags: text('expense_tags', { mode: 'json' }).$type<string[]>(),
    expenseAmount: integer('expense_amount'),
    expenseDescription: text('expense_description'),
    expenseSplitConfig: text('expense_split_config', { mode: 'json' }).$type<SplitConfig>(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastTriggeredAt: integer('last_triggered_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userActiveDueIdx: index('reminders_user_active_due_idx').on(
      table.userId,
      table.isActive,
      table.nextDueDate
    ),
  })
);

export const reminderVehicles = sqliteTable(
  'reminder_vehicles',
  {
    reminderId: text('reminder_id')
      .notNull()
      .references(() => reminders.id, { onDelete: 'cascade' }),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.reminderId, table.vehicleId] }),
    vehicleIdx: index('rv_vehicle_idx').on(table.vehicleId),
  })
);

export const reminderNotifications = sqliteTable(
  'reminder_notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    reminderId: text('reminder_id')
      .notNull()
      .references(() => reminders.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dueDate: integer('due_date', { mode: 'timestamp' }),
    dueOdometer: integer('due_odometer'),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userUnreadIdx: index('rn_user_unread_idx').on(table.userId, table.isRead),
    // SQLite treats NULLs as distinct in a UNIQUE index, so mileage rows (null dueDate) are not constrained here.
    reminderDueIdx: uniqueIndex('rn_reminder_due_idx').on(table.reminderId, table.dueDate),
    reminderOdoIdx: uniqueIndex('rn_reminder_odo_idx')
      .on(table.reminderId, table.dueOdometer)
      .where(sql`${table.dueOdometer} IS NOT NULL`),
  })
);

// Every route that reads a shared vehicle must go through utils/vehicle-access.ts.
export const vehicleShares = sqliteTable(
  'vehicle_shares',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sharedWithId: text('shared_with_id').references(() => users.id, { onDelete: 'cascade' }),
    level: text('level').notNull(),
    status: text('status').notNull().default('pending'),
    invitedEmail: text('invited_email'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    activeShareIdx: uniqueIndex('vehicle_shares_active_idx')
      .on(table.vehicleId, table.sharedWithId)
      .where(sql`status in ('pending','accepted')`),
    pendingInviteIdx: uniqueIndex('vehicle_shares_pending_invite_idx')
      .on(table.vehicleId, table.invitedEmail)
      .where(sql`shared_with_id is null and status = 'pending'`),
    sharedWithIdx: index('vehicle_shares_shared_with_idx').on(table.sharedWithId, table.status),
    ownerIdx: index('vehicle_shares_owner_idx').on(table.ownerId),
  })
);

export const roles = sqliteTable(
  'roles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    scope: text('scope', { enum: ['server', 'vehicle'] }).notNull(),
    key: text('key'),
    name: text('name').notNull(),
    color: text('color'),
    builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    scopeKeyIdx: uniqueIndex('roles_scope_key_idx').on(table.scope, table.key),
    ownerIdx: index('roles_owner_idx').on(table.ownerUserId),
  })
);

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permission] }),
  })
);

export const roleAssignments = sqliteTable(
  'role_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    scopeId: text('scope_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    grantedBy: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userRoleScopeIdx: uniqueIndex('ra_user_role_scope_idx').on(
      table.userId,
      table.roleId,
      table.scopeId
    ),
    serverUserRoleIdx: uniqueIndex('ra_server_user_role_idx')
      .on(table.userId, table.roleId)
      .where(sql`scope_id is null`),
    roleIdx: index('ra_role_idx').on(table.roleId),
    scopeIdx: index('ra_scope_idx').on(table.scopeId),
  })
);

export const permissionOverrides = sqliteTable(
  'permission_overrides',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['server', 'vehicle'] }).notNull(),
    scopeId: text('scope_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    effect: text('effect', { enum: ['allow', 'deny'] }).notNull(),
    setBy: text('set_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userScopePermissionIdx: uniqueIndex('po_user_scope_permission_idx').on(
      table.userId,
      table.scope,
      table.scopeId,
      table.permission
    ),
    serverUserPermissionIdx: uniqueIndex('po_server_user_permission_idx')
      .on(table.userId, table.scope, table.permission)
      .where(sql`scope_id is null`),
    scopeIdx: index('po_scope_idx').on(table.scopeId),
  })
);

export interface CalendarFeedOptions {
  reminders: boolean;
  insurance: boolean;
  loans: boolean;
  vehicleNames: boolean;
  amounts: boolean;
}

export const calendarFeeds = sqliteTable(
  'calendar_feeds',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    options: text('options', { mode: 'json' }).$type<CalendarFeedOptions>().notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdx: uniqueIndex('cf_user_idx').on(table.userId),
    tokenHashIdx: uniqueIndex('cf_token_hash_idx').on(table.tokenHash),
  })
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    failureCount: integer('failure_count').notNull().default(0),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('ps_user_idx').on(table.userId),
    userEndpointIdx: uniqueIndex('ps_user_endpoint_idx').on(table.userId, table.endpoint),
  })
);

export const communityStats = sqliteTable(
  'community_stats',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    scope: text('scope').notNull(),
    metric: text('metric').notNull(),
    bucketKey: text('bucket_key').notNull(),
    catalogModelId: text('catalog_model_id'),
    modelYear: integer('model_year'),
    vehicleType: text('vehicle_type'),
    ageBand: text('age_band'),
    region: text('region'),
    currency: text('currency'),
    unit: text('unit').notNull(),
    nPublished: integer('n_published').notNull(),
    mean: real('mean').notNull(),
    computedAt: integer('computed_at', { mode: 'timestamp' }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
  },
  (table) => ({
    scopeBucketIdx: uniqueIndex('community_stats_scope_bucket_idx').on(
      table.scope,
      table.bucketKey
    ),
  })
);

export const communityRefreshes = sqliteTable('community_refreshes', {
  scope: text('scope').primaryKey(),
  refreshedAt: integer('refreshed_at', { mode: 'timestamp' }).notNull(),
});

export type User = typeof users.$inferSelect;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleWithFinancing = Vehicle & {
  financing?: VehicleFinancing;
};

export type VehicleFinancing = typeof vehicleFinancing.$inferSelect;
export type NewVehicleFinancing = typeof vehicleFinancing.$inferInsert;

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;

export type InsuranceTerm = typeof insuranceTerms.$inferSelect;

export type InsuranceTermVehicle = typeof insuranceTermVehicles.$inferSelect;

export type InsuranceClaim = typeof insuranceClaims.$inferSelect;

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

export type SyncState = typeof syncState.$inferSelect;

export type UserProvider = typeof userProviders.$inferSelect;

export type Session = typeof sessions.$inferSelect;

export type OdometerEntry = typeof odometerEntries.$inferSelect;
export type NewOdometerEntry = typeof odometerEntries.$inferInsert;

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;

export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;

export type PhotoRef = typeof photoRefs.$inferSelect;
export type NewPhotoRef = typeof photoRefs.$inferInsert;

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

export type ReminderVehicle = typeof reminderVehicles.$inferSelect;
export type NewReminderVehicle = typeof reminderVehicles.$inferInsert;

export type ReminderNotification = typeof reminderNotifications.$inferSelect;
export type NewReminderNotification = typeof reminderNotifications.$inferInsert;

export type VehicleShare = typeof vehicleShares.$inferSelect;
export type NewVehicleShare = typeof vehicleShares.$inferInsert;

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

export type CommunityStat = typeof communityStats.$inferSelect;
export type NewCommunityStat = typeof communityStats.$inferInsert;

export type CalendarFeed = typeof calendarFeeds.$inferSelect;

export type Role = typeof roles.$inferSelect;
