import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// User table
export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  provider: text('provider').notNull().default('google'),
  providerId: text('provider_id').notNull(),
  googleRefreshToken: text('google_refresh_token'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Vehicle table
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
    currentInsurancePolicyId: text('current_insurance_policy_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index('vehicles_user_id_idx').on(table.userId),
  })
);

// Vehicle Financing table (loans, leases, or owned vehicles)
export const vehicleFinancing = sqliteTable('vehicle_financing', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  financingType: text('financing_type').notNull().default('loan'), // 'loan' | 'lease' | 'own'
  provider: text('provider').notNull(), // Lender name, leasing company, or dealer
  originalAmount: real('original_amount').notNull(),
  currentBalance: real('current_balance').notNull(),
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
});

// PolicyTerm type for the terms JSON column
export interface PolicyTerm {
  id: string;
  startDate: string;
  endDate: string;
  policyDetails: {
    policyNumber?: string;
    coverageDescription?: string;
    deductibleAmount?: number;
    coverageLimit?: number;
    agentName?: string;
    agentPhone?: string;
    agentEmail?: string;
  };
  financeDetails: {
    totalCost?: number;
    monthlyCost?: number;
    premiumFrequency?: string;
    paymentAmount?: number;
  };
}

// Insurance Policy table
export const insurancePolicies = sqliteTable('insurance_policies', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  company: text('company').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  currentTermStart: integer('current_term_start', { mode: 'timestamp' }),
  currentTermEnd: integer('current_term_end', { mode: 'timestamp' }),
  terms: text('terms', { mode: 'json' }).$type<PolicyTerm[]>().notNull().default([]),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Insurance Policy ↔ Vehicles junction table (per-term coverage)
export const insurancePolicyVehicles = sqliteTable(
  'insurance_policy_vehicles',
  {
    policyId: text('policy_id')
      .notNull()
      .references(() => insurancePolicies.id, { onDelete: 'cascade' }),
    termId: text('term_id').notNull(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.policyId, table.termId, table.vehicleId] }),
  })
);

// Split config type for expense groups
export type SplitConfig =
  | { method: 'even'; vehicleIds: string[] }
  | { method: 'absolute'; allocations: Array<{ vehicleId: string; amount: number }> }
  | { method: 'percentage'; allocations: Array<{ vehicleId: string; percentage: number }> };

// Expense Groups table (cross-vehicle cost allocation containers)
export const expenseGroups = sqliteTable('expense_groups', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  splitConfig: text('split_config', { mode: 'json' }).$type<SplitConfig>().notNull(),
  category: text('category').notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
  date: integer('date', { mode: 'timestamp' }).notNull(),
  description: text('description'),
  totalAmount: real('total_amount').notNull(),
  // No FK constraint — insurance delete handler nullifies these via application logic
  // to preserve expense groups as historical records
  insurancePolicyId: text('insurance_policy_id'),
  insuranceTermId: text('insurance_term_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Expense table
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
    fuelAmount: real('fuel_amount'),
    fuelType: text('fuel_type'),
    isFinancingPayment: integer('is_financing_payment', { mode: 'boolean' })
      .notNull()
      .default(false),
    insurancePolicyId: text('insurance_policy_id'),
    insuranceTermId: text('insurance_term_id'),
    missedFillup: integer('missed_fillup', { mode: 'boolean' }).notNull().default(false),
    expenseGroupId: text('expense_group_id').references(() => expenseGroups.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => ({
    vehicleDateIdx: index('expenses_vehicle_date_idx').on(table.vehicleId, table.date),
    vehicleCategoryDateIdx: index('expenses_vehicle_category_date_idx').on(
      table.vehicleId,
      table.category,
      table.date
    ),
    expenseGroupIdx: index('expenses_group_idx').on(table.expenseGroupId),
    categoryDateIdx: index('expenses_category_date_idx').on(table.category, table.date),
  })
);

// User Settings table
export const userSettings = sqliteTable('user_settings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Unit preferences
  distanceUnit: text('distance_unit').notNull().default('miles'), // 'miles' | 'kilometers'
  volumeUnit: text('volume_unit').notNull().default('gallons_us'), // 'gallons_us' | 'gallons_uk' | 'liters'
  chargeUnit: text('charge_unit').notNull().default('kwh'), // 'kwh' (for electric vehicles)
  currencyUnit: text('currency_unit').notNull().default('USD'),
  // Backup preferences (for data dumps)
  autoBackupEnabled: integer('auto_backup_enabled', { mode: 'boolean' }).notNull().default(false),
  backupFrequency: text('backup_frequency').notNull().default('weekly'), // 'daily' | 'weekly' | 'monthly'
  lastBackupDate: integer('last_backup_date', { mode: 'timestamp' }),
  googleDriveBackupEnabled: integer('google_drive_backup_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  googleDriveBackupFolderId: text('google_drive_backup_folder_id'), // Folder for backups
  googleDriveBackupRetentionCount: integer('google_drive_backup_retention_count')
    .notNull()
    .default(10), // Number of backups to keep in Google Drive
  googleDriveCustomFolderName: text('google_drive_custom_folder_name'),
  // Sync preferences (for Google Sheets mirroring)
  googleSheetsSyncEnabled: integer('google_sheets_sync_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  googleSheetsSpreadsheetId: text('google_sheets_spreadsheet_id'), // The synced spreadsheet
  syncOnInactivity: integer('sync_on_inactivity', { mode: 'boolean' }).notNull().default(true),
  syncInactivityMinutes: integer('sync_inactivity_minutes').notNull().default(5), // Minutes of inactivity before sync
  lastSyncDate: integer('last_sync_date', { mode: 'timestamp' }),
  lastDataChangeDate: integer('last_data_change_date', { mode: 'timestamp' }), // Track when data was last modified
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Lucia Auth session table
export const sessions = sqliteTable('sessions', {
  id: text('id').notNull().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

// Drizzle relations for expense groups
export const expenseGroupsRelations = relations(expenseGroups, ({ one, many }) => ({
  user: one(users, { fields: [expenseGroups.userId], references: [users.id] }),
  children: many(expenses),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  vehicle: one(vehicles, { fields: [expenses.vehicleId], references: [vehicles.id] }),
  expenseGroup: one(expenseGroups, {
    fields: [expenses.expenseGroupId],
    references: [expenseGroups.id],
  }),
}));

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

export type InsurancePolicyVehicle = typeof insurancePolicyVehicles.$inferSelect;
export type NewInsurancePolicyVehicle = typeof insurancePolicyVehicles.$inferInsert;

export type ExpenseGroup = typeof expenseGroups.$inferSelect;
export type NewExpenseGroup = typeof expenseGroups.$inferInsert;

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type OdometerEntry = typeof odometerEntries.$inferSelect;
export type NewOdometerEntry = typeof odometerEntries.$inferInsert;

// Odometer Entries table (manual readings + expense-linked auto-entries)
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
    linkedEntityType: text('linked_entity_type'),
    linkedEntityId: text('linked_entity_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    vehicleDateIdx: index('odometer_vehicle_date_idx').on(table.vehicleId, table.recordedAt),
    linkedEntityIdx: index('odometer_linked_entity_idx').on(
      table.linkedEntityType,
      table.linkedEntityId
    ),
  })
);

// Photos table (polymorphic: entityType + entityId)
export const photos = sqliteTable(
  'photos',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    driveFileId: text('drive_file_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    webViewLink: text('web_view_link'),
    isCover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => ({
    entityIdx: index('photos_entity_idx').on(table.entityType, table.entityId),
  })
);

export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type PhotoEntityType =
  | 'vehicle'
  | 'expense'
  | 'trip'
  | 'insurance_policy'
  | 'expense_group'
  | 'odometer_entry';
