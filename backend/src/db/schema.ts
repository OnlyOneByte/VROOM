import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
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
import type { ReminderSplitConfig } from './types';

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
    purchasePrice: integer('purchase_price'), // money: integer CENTS (migration 0009)
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
    // License-plate uniqueness is PER-USER, not global (migration 0005, C233): two users may
    // legitimately register the same plate string (reissued plates, sold-then-rebought cars), and a
    // global unique index both wrongly blocked the second user AND leaked plate existence across
    // tenants. Partial (WHERE license_plate IS NOT NULL) so plate-less vehicles don't collide.
    userLicensePlateIdx: uniqueIndex('vehicles_user_license_plate_idx')
      .on(table.userId, table.licensePlate)
      .where(sql`${table.licensePlate} IS NOT NULL`),
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
    originalAmount: integer('original_amount').notNull(), // money: integer CENTS (migration 0009)
    apr: real('apr'), // For loans, null for leases/own — a PERCENT, stays real (NOT money)
    termMonths: integer('term_months').notNull(),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    // Payment Configuration
    paymentAmount: integer('payment_amount').notNull(), // money: integer CENTS (migration 0009)
    paymentFrequency: text('payment_frequency').notNull().default('monthly'), // 'monthly' | 'bi-weekly' | 'weekly' | 'custom'
    paymentDayOfMonth: integer('payment_day_of_month'), // For monthly (1-31)
    paymentDayOfWeek: integer('payment_day_of_week'), // For weekly (0-6, Sunday=0)
    // Lease-specific fields
    residualValue: integer('residual_value'), // money: integer CENTS (migration 0009) — End-of-lease buyout price
    mileageLimit: integer('mileage_limit'), // Annual mileage limit for leases (a MILEAGE count, NOT money)
    excessMileageFee: integer('excess_mileage_fee'), // money: integer CENTS (migration 0009) — Per-mile fee over limit
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
    deductibleAmount: integer('deductible_amount'), // money: integer CENTS (migration 0009)
    coverageLimit: integer('coverage_limit'), // money: integer CENTS (migration 0009) — a dollar cap, not a %
    agentName: text('agent_name'),
    agentPhone: text('agent_phone'),
    agentEmail: text('agent_email'),
    totalCost: integer('total_cost'), // money: integer CENTS (migration 0009)
    monthlyCost: integer('monthly_cost'), // money: integer CENTS (migration 0009)
    premiumFrequency: text('premium_frequency'),
    paymentAmount: integer('payment_amount'), // money: integer CENTS (migration 0009)
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

// Insurance Claims table — a claim filed against a policy (optionally a specific
// term and vehicle). claimType / status / faultDesignation are free-text columns
// whose allowed values are enforced by the zod validation layer, mirroring how
// insurance_terms.premiumFrequency is handled (text column + app-level enum).
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
    claimType: text('claim_type').notNull(), // collision | theft | weather | vandalism | other
    description: text('description'),
    status: text('status').notNull().default('filed'), // filed | in_progress | settled | denied
    payoutAmount: integer('payout_amount'), // money: integer CENTS (migration 0009)
    faultDesignation: text('fault_designation'), // at_fault | not_at_fault | shared | null
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    policyIdIdx: index('ic_policy_id_idx').on(table.policyId),
    policyStatusIdx: index('ic_policy_status_idx').on(table.policyId, table.status),
    vehicleIdx: index('ic_vehicle_idx').on(table.vehicleId),
  })
);

// Split method type for split expenses
export type SplitMethod = 'even' | 'absolute' | 'percentage';

// Expense table (v2: fuelAmount → volume, removed insurancePolicyId; v3: removed isFinancingPayment + insuranceTermId, uses sourceType/sourceId)
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
    // expense-location T1 (migration 0012): an OPTIONAL free-text location label (e.g. "Shell, Main St").
    // D1/D5 — free-text only, NO GPS in v1 (mirrors trips.startLocation). Length-capped at the Zod edge.
    location: text('location'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    expenseAmount: integer('expense_amount').notNull(), // money: integer CENTS (migration 0009)
    volume: real('volume'), // gallons / kWh — a QUANTITY, stays real (NOT money)
    fuelType: text('fuel_type'),
    missedFillup: integer('missed_fillup', { mode: 'boolean' }).notNull().default(false),
    // Direct user ownership — eliminates vehicles JOIN for user-scoped queries.
    // For a SHARED-created row (an editor logged a cost on someone else's vehicle, vehicle-sharing
    // T5b owner-stamp model) this is the vehicle OWNER's id — so the row rides the owner's backup/TCO
    // and counts once. The actual author is recorded in `createdBy`.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // PROVENANCE — who physically entered the row (vehicle-sharing T5b, migration 0011). Differs from
    // `userId` only for an editor-created shared row (createdBy = editor, userId = owner). NULL =
    // legacy/self-created (treat as createdBy === userId). onDelete SET NULL: this is provenance, not
    // ownership — deleting the author must NOT delete the owner's cost-history row.
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    // NULL for standalone expenses, shared UUID for split siblings
    groupId: text('group_id'),
    // Pre-split total amount, same on all siblings in a group — money: integer CENTS (migration 0009)
    groupTotal: integer('group_total'),
    // Split method: 'even' | 'absolute' | 'percentage'
    splitMethod: text('split_method'),
    // Source tracking — nullable, server-set only (e.g., 'reminder', 'import', 'api')
    sourceType: text('source_type'),
    sourceId: text('source_id'),
    // Offline idempotency key — client-generated UUID for expenses created via the
    // offline outbox. NULL for server- or legacy-created rows. Scoped unique per user
    // so a retried offline POST returns the original row instead of duplicating it.
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
    // userId-based indexes for analytics hot paths
    userDateIdx: index('expenses_user_date_idx').on(table.userId, table.date),
    userCategoryDateIdx: index('expenses_user_category_date_idx').on(
      table.userId,
      table.category,
      table.date
    ),
    // Group lookup for split operations
    groupIdx: index('expenses_group_idx').on(table.groupId),
    // Source tracking lookup (e.g., all expenses from a specific reminder or financing)
    sourceIdx: index('expenses_source_idx').on(table.sourceType, table.sourceId),
    // Offline idempotency: partial unique index so a retried create with the same
    // client_id returns the original row. Partial (WHERE client_id IS NOT NULL) so
    // the many NULL rows from server/legacy creates are unaffected.
    userClientIdx: uniqueIndex('expenses_user_client_idx')
      .on(table.userId, table.clientId)
      .where(sql`${table.clientId} IS NOT NULL`),
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
  // Theming engine (theming-engine spec T1, D2). The user's selected theme id; 'default' reproduces
  // today's look byte-for-byte, so this is fully additive — existing rows backfill 'default' and
  // nothing changes until a user picks another theme. The light/dark *mode* stays device-local
  // (localStorage) by current convention (D2); only the theme *id* is persisted/synced here.
  themePreference: text('theme_preference').notNull().default('default'),
  // trips-location D3 (T8): the DEFAULT business-mileage reimbursement rate in $/mile (e.g. 0.67). The trip
  // mileage-summary uses it when no explicit ?rate= override is passed (a per-trip override is a thin
  // additive follow-on). Fully additive — existing rows backfill 0 (= today's behavior: businessValue 0
  // until a rate is set). A RATE, not a stored money AMOUNT, so it stays `real` (naturally fractional) and
  // is out of scope for the money-cents integer migration (which covers the 14 money-amount columns); the
  // business $ it produces is computed at display time (design.md §7) and inherits money handling there.
  businessMileageRate: real('business_mileage_rate').notNull().default(0),
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

// Relations
export const expensesRelations = relations(expenses, ({ one }) => ({
  vehicle: one(vehicles, { fields: [expenses.vehicleId], references: [vehicles.id] }),
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

// Trips table (trips-location T1, spec §1) — manual trip log per vehicle. Mirrors odometerEntries (the
// closest existing shape). `distance` is NOT stored; it's derived `max(0, endOdometer − startOdometer)` at
// read time (R2, the #46 clamp) so a later odometer correction can't desync a stored distance. No GPS in v1
// (D5): startLocation/endLocation are optional free-text labels. The business-mileage rate lives in
// preferences (display-time), so this table introduces NO float-money column (design §7 — inherits the
// money-cents migration cleanly).
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
    endOdometer: integer('end_odometer').notNull(), // R2: end >= start enforced at Zod; distance derived
    purpose: text('purpose').notNull(), // 'business' | 'personal' | 'commute' | 'other' (D4)
    tripDate: integer('trip_date', { mode: 'timestamp' }).notNull(),
    startLocation: text('start_location'), // D5: free-text label, optional (no GPS in v1)
    endLocation: text('end_location'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleDateIdx: index('trips_vehicle_date_idx').on(table.vehicleId, table.tripDate),
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

// Reminders table
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
    type: text('type').notNull(), // 'expense' | 'notification'
    actionMode: text('action_mode').notNull().default('automatic'), // 'automatic' | 'requires_confirmation'
    frequency: text('frequency').notNull(), // 'weekly' | 'monthly' | 'yearly' | 'custom'
    intervalValue: integer('interval_value'), // for custom: e.g. 3
    intervalUnit: text('interval_unit'), // 'day' | 'week' | 'month' | 'year'
    // Maintenance-schedule (cycle 15, spec .kiro/specs/maintenance-schedule): a reminder may be
    // due by time, by mileage, or by whichever-comes-first. These are additive + nullable/
    // defaulted so existing reminders behave identically (triggerMode defaults to 'time').
    triggerMode: text('trigger_mode').notNull().default('time'), // 'time' | 'mileage' | 'both'
    intervalMileage: integer('interval_mileage'), // distance interval, in the vehicle's distanceUnit
    lastServiceOdometer: integer('last_service_odometer'), // anchor for the mileage axis
    nextDueOdometer: integer('next_due_odometer'), // cache = lastServiceOdometer + intervalMileage
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    endDate: integer('end_date', { mode: 'timestamp' }), // null = runs forever
    // Nullable as of T3 (cycle 22): a mileage-ONLY reminder has no time axis, so it carries no
    // next_due_date. The time-due query null-guards (`IS NOT NULL AND next_due_date <= now`) and
    // the trigger loop skips a null date. Relaxing this from NOT NULL forced a SQLite table rebuild
    // (migration 0004), hand-authored child-first so the reminder_vehicles / reminder_notifications
    // ON DELETE CASCADE does not wipe child rows (the C15 lesson: PRAGMA foreign_keys=OFF is a
    // no-op inside the migrator's transaction).
    nextDueDate: integer('next_due_date', { mode: 'timestamp' }),
    expenseCategory: text('expense_category'),
    expenseTags: text('expense_tags', { mode: 'json' }).$type<string[]>(),
    expenseAmount: integer('expense_amount'), // money: integer CENTS (migration 0009) — total amount, required when type='expense' + actionMode='automatic'
    expenseDescription: text('expense_description'),
    expenseSplitConfig: text('expense_split_config', { mode: 'json' }).$type<ReminderSplitConfig>(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastTriggeredAt: integer('last_triggered_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    // Optimal for the overdue query: WHERE user_id = ? AND is_active = true AND next_due_date <= now
    userActiveDueIdx: index('reminders_user_active_due_idx').on(
      table.userId,
      table.isActive,
      table.nextDueDate
    ),
  })
);

// Reminder ↔ Vehicles junction table
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

// Reminder Notifications table (persistent notification state)
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
    // Nullable as of T3 (cycle 22): a mileage-fired notification has no time period, so it carries
    // no due_date (its milestone lives in due_odometer instead). Exactly one of dueDate/dueOdometer
    // is set per notification (time axis vs mileage axis).
    dueDate: integer('due_date', { mode: 'timestamp' }), // the period this notification is for (time axis)
    // Odometer milestone for a mileage-fired notification (cycle 15 column; activated T3, cycle 22).
    dueOdometer: integer('due_odometer'),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userUnreadIdx: index('rn_user_unread_idx').on(table.userId, table.isRead),
    // Time axis: dedups one notification per reminder + period. dueDate is now nullable; SQLite
    // treats NULLs as distinct in a UNIQUE index, so mileage rows (null dueDate) are not
    // constrained here — they get their own index below.
    reminderDueIdx: uniqueIndex('rn_reminder_due_idx').on(table.reminderId, table.dueDate),
    // Mileage axis: dedups one notification per reminder + odometer milestone. PARTIAL index
    // (WHERE due_odometer IS NOT NULL) so it only constrains mileage rows — folding dueOdometer
    // into the time index instead would break time-axis dedup (its NULL dueOdometer is distinct).
    reminderOdoIdx: uniqueIndex('rn_reminder_odo_idx')
      .on(table.reminderId, table.dueOdometer)
      .where(sql`${table.dueOdometer} IS NOT NULL`),
  })
);

// Vehicle sharing (migration 0010, vehicle-sharing T1; Angelo ratified D1-D8 2026-06-27).
// An OWNER grants another existing VROOM user scoped access to ONE of their vehicles. This is the
// ONLY widening of cross-userId access in VROOM (NORTH_STAR #2) — every read/write route that opts a
// shared vehicle in routes through utils/sharing.ts (T2), never raw. IDs are text/cuid2 to match
// users.id + vehicles.id (the design draft said integer — corrected to the live schema). All three
// FKs cascade so a deleted vehicle/owner/invitee drops the share row (D8); shared-CREATED expense
// rows are owner-userId-stamped and are NOT touched by this cascade (real cost history stays).
export const vehicleShares = sqliteTable(
  'vehicle_shares',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }), // revoke-on-vehicle-delete (D8)
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }), // denormalized for the owner-side list query
    sharedWithId: text('shared_with_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }), // the invitee
    level: text('level').notNull(), // 'viewer' | 'editor' (Zod enum at the route)
    status: text('status').notNull().default('pending'), // 'pending'|'accepted'|'declined'|'revoked'
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    // One ACTIVE share per (vehicle, invitee). Partial (WHERE status IN pending/accepted) so a
    // declined/revoked row does NOT block re-inviting the same user to the same vehicle later.
    activeShareIdx: uniqueIndex('vehicle_shares_active_idx')
      .on(table.vehicleId, table.sharedWithId)
      .where(sql`status in ('pending','accepted')`),
    // Invitee-side "shared with me" lookup (by invitee + status).
    sharedWithIdx: index('vehicle_shares_shared_with_idx').on(table.sharedWithId, table.status),
    // Owner-side "shares I granted" lookup.
    ownerIdx: index('vehicle_shares_owner_idx').on(table.ownerId),
  })
);

// Push subscriptions (migration 0013, push-notifications T1). A per-user, per-DEVICE Web Push
// subscription — the endpoint + the two client crypto keys (p256dh + auth) the W3C Push API returns
// from pushManager.subscribe(). UserId-scoped (the reminder_notifications shape): a user may have many
// devices, each one row; FK-cascade so a deleted user drops their subscriptions. NOT a backed-up table
// (it sits on EXCLUDED_BY_DESIGN beside sessions/user_providers): the keys are device-ephemeral secrets
// re-derivable client-side, and a restored stale subscription would push to a dead endpoint in a new
// environment — the same "ephemeral, meaningless/unsafe to restore" rationale as sessions.
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The push-service delivery URL (vendor-specific: fcm.googleapis / web.push.apple / updates.push.services.mozilla …).
    endpoint: text('endpoint').notNull(),
    // The client public key (base64url) — half of the message-encryption keypair the SW holds.
    p256dh: text('p256dh').notNull(),
    // The client auth secret (base64url) — the other half; together they encrypt the push payload.
    auth: text('auth').notNull(),
    // Optional label so the user can recognize a device in a "your devices" list.
    userAgent: text('user_agent'),
    // Consecutive transient send failures; a row past a cap is reaped (the #135 reaping-hygiene class).
    failureCount: integer('failure_count').notNull().default(0),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('ps_user_idx').on(table.userId),
    // Idempotent re-subscribe: the same browser re-subscribing returns the SAME endpoint, so upsert
    // by (userId, endpoint) — never duplicate a device. Scoped by userId so two users could never
    // collide on a shared endpoint (they cannot — endpoints are per-subscription — but the scope keeps
    // the unique key tenant-local, mirroring the rest of VROOM).
    userEndpointIdx: uniqueIndex('ps_user_endpoint_idx').on(table.userId, table.endpoint),
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
