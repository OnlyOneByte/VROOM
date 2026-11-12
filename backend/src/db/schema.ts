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
import type { BackupConfig, StorageConfig, UnitPreferences } from '../types';
import { DEFAULT_BACKUP_CONFIG, DEFAULT_STORAGE_CONFIG, DEFAULT_UNIT_PREFERENCES } from '../types';
import type { SplitConfig } from './types';

export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

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

export const sessions = sqliteTable('sessions', {
  id: text('id').notNull().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

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
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleDateIdx: index('odometer_vehicle_date_idx').on(table.vehicleId, table.recordedAt),
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

// Every route that reads a shared vehicle must go through utils/sharing.ts.
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
    sharedWithId: text('shared_with_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: text('level').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    activeShareIdx: uniqueIndex('vehicle_shares_active_idx')
      .on(table.vehicleId, table.sharedWithId)
      .where(sql`status in ('pending','accepted')`),
    sharedWithIdx: index('vehicle_shares_shared_with_idx').on(table.sharedWithId, table.status),
    ownerIdx: index('vehicle_shares_owner_idx').on(table.ownerId),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleWithFinancing = Vehicle & {
  financing?: VehicleFinancing;
};

export type VehicleFinancing = typeof vehicleFinancing.$inferSelect;
export type NewVehicleFinancing = typeof vehicleFinancing.$inferInsert;

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type NewInsurancePolicy = typeof insurancePolicies.$inferInsert;

export type InsuranceTerm = typeof insuranceTerms.$inferSelect;
export type NewInsuranceTerm = typeof insuranceTerms.$inferInsert;

export type InsuranceTermVehicle = typeof insuranceTermVehicles.$inferSelect;
export type NewInsuranceTermVehicle = typeof insuranceTermVehicles.$inferInsert;

export type InsuranceClaim = typeof insuranceClaims.$inferSelect;
export type NewInsuranceClaim = typeof insuranceClaims.$inferInsert;

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

export type UserProvider = typeof userProviders.$inferSelect;
export type NewUserProvider = typeof userProviders.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

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
