import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
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

// User table
export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Vehicle table (v2: removed currentInsurancePolicyId)
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
    vehicleType: text('vehicle_type').notNull().default('gas'), // 'gas' | 'electric' | 'hybrid'
    trackFuel: integer('track_fuel', { mode: 'boolean' }).notNull().default(true),
    trackCharging: integer('track_charging', { mode: 'boolean' }).notNull().default(false),
    licensePlate: text('license_plate'),
    nickname: text('nickname'),
    vin: text('vin'),
    initialMileage: integer('initial_mileage'),
    purchasePrice: real('purchase_price'),
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
  })
);

// Vehicle Financing table (v2: removed currentBalance — computed on read)
export const vehicleFinancing = sqliteTable(
  'vehicle_financing',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    financingType: text('financing_type').notNull().default('loan'), // 'loan' | 'lease' | 'own'
    provider: text('provider').notNull(), // Lender name, leasing company, or dealer
    originalAmount: real('original_amount').notNull(),
    apr: real('apr'), // For loans, null for leases/own
    termMonths: integer('term_months').notNull(),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    // Payment Configuration
    paymentAmount: real('payment_amount').notNull(),
    paymentFrequency: text('payment_frequency').notNull().default('monthly'), // 'monthly' | 'bi-weekly' | 'weekly' | 'custom'
    paymentDayOfMonth: integer('payment_day_of_month'), // For monthly (1-31)
    paymentDayOfWeek: integer('payment_day_of_week'), // For weekly (0-6, Sunday=0)
    // Lease-specific fields
    residualValue: real('residual_value'), // End-of-lease buyout price
    mileageLimit: integer('mileage_limit'), // Annual mileage limit for leases
    excessMileageFee: real('excess_mileage_fee'), // Per-mile fee over limit
    // Status
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    endDate: integer('end_date', { mode: 'timestamp' }), // Payoff date or lease end date
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleIdIdx: index('vf_vehicle_id_idx').on(table.vehicleId),
  })
);

// Insurance Policy table (v2: removed terms JSON, currentTermStart, currentTermEnd)
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

// Insurance Terms table (v2: extracted from JSON column on insurance_policies)
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
    deductibleAmount: real('deductible_amount'),
    coverageLimit: real('coverage_limit'),
    agentName: text('agent_name'),
    agentPhone: text('agent_phone'),
    agentEmail: text('agent_email'),
    totalCost: real('total_cost'),
    monthlyCost: real('monthly_cost'),
    premiumFrequency: text('premium_frequency'),
    paymentAmount: real('payment_amount'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    policyIdIdx: index('it_policy_id_idx').on(table.policyId),
    policyEndDateIdx: index('it_policy_end_date_idx').on(table.policyId, table.endDate),
  })
);

// Insurance Term ↔ Vehicles junction table (v2: replaces insurancePolicyVehicles)
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

// Split method type for split expenses
export type SplitMethod = 'even' | 'absolute' | 'percentage';

// Expense table (v2: fuelAmount → volume, removed insurancePolicyId, added insuranceTermId FK)
export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // ExpenseCategory enum values
    tags: text('tags', { mode: 'json' }).$type<string[]>(), // JSON array of tags (replaces type)
    date: integer('date', { mode: 'timestamp' }).notNull(),
    mileage: integer('mileage'),
    description: text('description'),
    receiptUrl: text('receipt_url'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    expenseAmount: real('expense_amount').notNull(),
    volume: real('volume'),
    fuelType: text('fuel_type'),
    isFinancingPayment: integer('is_financing_payment', { mode: 'boolean' })
      .notNull()
      .default(false),
    insuranceTermId: text('insurance_term_id').references(() => insuranceTerms.id, {
      onDelete: 'set null',
    }),
    missedFillup: integer('missed_fillup', { mode: 'boolean' }).notNull().default(false),
    // Direct user ownership — eliminates vehicles JOIN for user-scoped queries
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // NULL for standalone expenses, shared UUID for split siblings
    groupId: text('group_id'),
    // Pre-split total amount, same on all siblings in a group
    groupTotal: real('group_total'),
    // Split method: 'even' | 'absolute' | 'percentage'
    splitMethod: text('split_method'),
  },
  (table) => ({
    vehicleDateIdx: index('expenses_vehicle_date_idx').on(table.vehicleId, table.date),
    vehicleCategoryDateIdx: index('expenses_vehicle_category_date_idx').on(
      table.vehicleId,
      table.category,
      table.date
    ),
    categoryDateIdx: index('expenses_category_date_idx').on(table.category, table.date),
    // userId-based indexes for analytics hot paths
    userDateIdx: index('expenses_user_date_idx').on(table.userId, table.date),
    userCategoryDateIdx: index('expenses_user_category_date_idx').on(
      table.userId,
      table.category,
      table.date
    ),
    // Group lookup for split operations
    groupIdx: index('expenses_group_idx').on(table.groupId),
    // Insurance term lookup
    insuranceTermIdx: index('expenses_insurance_term_idx').on(table.insuranceTermId),
  })
);

// User Providers table (domain-agnostic provider connections) — UNCHANGED in v2
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
  })
);

// User Preferences table (v2: split from userSettings — write-rare, user-facing settings)
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  unitPreferences: text('unit_preferences', { mode: 'json' })
    .$type<UnitPreferences>()
    .notNull()
    .default(DEFAULT_UNIT_PREFERENCES),
  currencyUnit: text('currency_unit').notNull().default('USD'),
  autoBackupEnabled: integer('auto_backup_enabled', { mode: 'boolean' }).notNull().default(false),
  backupFrequency: text('backup_frequency').notNull().default('weekly'), // 'daily' | 'weekly' | 'monthly'
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

// Sync State table (v2: split from userSettings — write-heavy, system timestamps only)
// NOTE: No createdAt/updatedAt columns by design
export const syncState = sqliteTable('sync_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastSyncDate: integer('last_sync_date', { mode: 'timestamp' }),
  lastDataChangeDate: integer('last_data_change_date', { mode: 'timestamp' }),
  lastBackupDate: integer('last_backup_date', { mode: 'timestamp' }),
});

// Lucia Auth session table
export const sessions = sqliteTable('sessions', {
  id: text('id').notNull().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

// Relations (v2: added insuranceTermId → insuranceTerms)
export const expensesRelations = relations(expenses, ({ one }) => ({
  vehicle: one(vehicles, { fields: [expenses.vehicleId], references: [vehicles.id] }),
  insuranceTerm: one(insuranceTerms, {
    fields: [expenses.insuranceTermId],
    references: [insuranceTerms.id],
  }),
}));

// Odometer Entries table (v2: removed linkedEntityType, linkedEntityId, odometer_linked_entity_idx)
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

// Photos table (v2: added userId FK, added photos_user_entity_type_idx)
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

// Photo Refs table (v2: removed pendingIdx — will be manually appended as partial index)
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
  })
);

// Export types for use in application
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

// Extended Vehicle type with optional financing relationship
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

export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;

export type PhotoRef = typeof photoRefs.$inferSelect;
export type NewPhotoRef = typeof photoRefs.$inferInsert;
