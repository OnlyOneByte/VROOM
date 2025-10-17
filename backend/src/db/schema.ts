import { createId } from '@paralleldrive/cuid2';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
export const vehicles = sqliteTable('vehicles', {
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
  licensePlate: text('license_plate'),
  nickname: text('nickname'),
  initialMileage: integer('initial_mileage'),
  purchasePrice: real('purchase_price'),
  purchaseDate: integer('purchase_date', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

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

// Vehicle Financing Payment Records
export const vehicleFinancingPayments = sqliteTable('vehicle_financing_payments', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  financingId: text('financing_id')
    .notNull()
    .references(() => vehicleFinancing.id, { onDelete: 'cascade' }),
  paymentDate: integer('payment_date', { mode: 'timestamp' }).notNull(),
  paymentAmount: real('payment_amount').notNull(),
  principalAmount: real('principal_amount').notNull(),
  interestAmount: real('interest_amount').notNull(), // 0 for leases
  remainingBalance: real('remaining_balance').notNull(),
  paymentNumber: integer('payment_number').notNull(),
  paymentType: text('payment_type').notNull().default('standard'), // 'standard' | 'extra' | 'custom-split'
  isScheduled: integer('is_scheduled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Insurance Policy table
export const insurancePolicies = sqliteTable('insurance_policies', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  policyNumber: text('policy_number'),
  totalCost: real('total_cost').notNull(),
  termLengthMonths: integer('term_length_months').notNull(), // e.g., 6 for 6-month terms
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  endDate: integer('end_date', { mode: 'timestamp' }).notNull(),
  monthlyCost: real('monthly_cost').notNull(), // Calculated: totalCost / termLengthMonths
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Expense table
export const expenses = sqliteTable('expenses', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  tags: text('tags'), // JSON array of tags (replaces type)
  category: text('category').notNull(), // ExpenseCategory enum values
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  date: integer('date', { mode: 'timestamp' }).notNull(),
  mileage: integer('mileage'),
  volume: real('volume'), // For fuel expenses (gallons or liters)
  charge: real('charge'), // For electric charging (kWh)
  description: text('description'),
  receiptUrl: text('receipt_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Vehicle Shares table (for sharing vehicles between users)
export const vehicleShares = sqliteTable('vehicle_shares', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sharedWithUserId: text('shared_with_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull().default('view'), // 'view' | 'edit'
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'declined'
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

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

// Export types for use in application
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleFinancing = typeof vehicleFinancing.$inferSelect;
export type NewVehicleFinancing = typeof vehicleFinancing.$inferInsert;

export type VehicleFinancingPayment = typeof vehicleFinancingPayments.$inferSelect;
export type NewVehicleFinancingPayment = typeof vehicleFinancingPayments.$inferInsert;

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type NewInsurancePolicy = typeof insurancePolicies.$inferInsert;

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export type VehicleShare = typeof vehicleShares.$inferSelect;
export type NewVehicleShare = typeof vehicleShares.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
