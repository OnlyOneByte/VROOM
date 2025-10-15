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
  licensePlate: text('license_plate'),
  nickname: text('nickname'),
  initialMileage: integer('initial_mileage'),
  purchasePrice: real('purchase_price'),
  purchaseDate: integer('purchase_date', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Vehicle Loan table (containerized loan information)
export const vehicleLoans = sqliteTable('vehicle_loans', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  lender: text('lender').notNull(),
  originalAmount: real('original_amount').notNull(),
  currentBalance: real('current_balance').notNull(),
  apr: real('apr').notNull(),
  termMonths: integer('term_months').notNull(),
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  // Payment Configuration
  paymentAmount: real('payment_amount').notNull(),
  paymentFrequency: text('payment_frequency').notNull().default('monthly'), // 'monthly' | 'bi-weekly' | 'weekly' | 'custom'
  paymentDayOfMonth: integer('payment_day_of_month'), // For monthly (1-31)
  paymentDayOfWeek: integer('payment_day_of_week'), // For weekly (0-6, Sunday=0)
  // Loan Status
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  payoffDate: integer('payoff_date', { mode: 'timestamp' }), // Actual payoff date if paid early
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Loan Payment Records
export const loanPayments = sqliteTable('loan_payments', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  loanId: text('loan_id')
    .notNull()
    .references(() => vehicleLoans.id, { onDelete: 'cascade' }),
  paymentDate: integer('payment_date', { mode: 'timestamp' }).notNull(),
  paymentAmount: real('payment_amount').notNull(),
  principalAmount: real('principal_amount').notNull(),
  interestAmount: real('interest_amount').notNull(),
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
  type: text('type').notNull(), // ExpenseType enum values
  category: text('category').notNull(), // ExpenseCategory enum values
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  date: integer('date', { mode: 'timestamp' }).notNull(),
  mileage: integer('mileage'),
  gallons: real('gallons'), // For fuel expenses
  description: text('description'),
  receiptUrl: text('receipt_url'),
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

export type VehicleLoan = typeof vehicleLoans.$inferSelect;
export type NewVehicleLoan = typeof vehicleLoans.$inferInsert;

export type LoanPayment = typeof loanPayments.$inferSelect;
export type NewLoanPayment = typeof loanPayments.$inferInsert;

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type NewInsurancePolicy = typeof insurancePolicies.$inferInsert;

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
