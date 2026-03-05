/**
 * Shared test generators for analytics property tests.
 *
 * Provides fast-check arbitraries for users, vehicles, expenses,
 * and a helper to set up an in-memory SQLite DB with the full schema.
 */

import { Database } from 'bun:sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';

// ---------------------------------------------------------------------------
// Types for generated test data
// ---------------------------------------------------------------------------
export interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

export interface TestVehicle {
  id: string;
  userId: string;
  make: string;
  model: string;
  year: number;
  currentInsurancePolicyId: string | null;
}

export interface TestExpense {
  id: string;
  vehicleId: string;
  category: string;
  expenseAmount: number;
  date: Date;
  mileage: number | null;
  fuelAmount: number | null;
  fuelType: string | null;
  missedFillup: boolean;
}

export interface TestInsurancePolicy {
  id: string;
  company: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Expense categories — must match the actual enum
// ---------------------------------------------------------------------------
const EXPENSE_CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a unique test user. */
export function userArb(index: number): fc.Arbitrary<TestUser> {
  return fc.constant({
    id: `user-${index}`,
    email: `user${index}@test.com`,
    displayName: `Test User ${index}`,
  });
}

/** Generate a test vehicle linked to a user. */
export function vehicleArb(userId: string, vehicleIndex: number): fc.Arbitrary<TestVehicle> {
  return fc.record({
    id: fc.constant(`vehicle-${userId}-${vehicleIndex}`),
    userId: fc.constant(userId),
    make: fc.constantFrom('Toyota', 'Honda', 'Ford', 'BMW', 'Tesla'),
    model: fc.constantFrom('Camry', 'Civic', 'F-150', 'X3', 'Model 3'),
    year: fc.integer({ min: 2000, max: 2025 }),
    currentInsurancePolicyId: fc.constant(null),
  });
}

/** Generate a test expense linked to a vehicle with realistic values. */
export function expenseArb(
  vehicleId: string,
  expenseIndex: number,
  yearConstraint?: number
): fc.Arbitrary<TestExpense> {
  // Use integer timestamps to avoid invalid Date edge cases
  const minTs = yearConstraint
    ? new Date(yearConstraint, 0, 2).getTime()
    : new Date(2020, 0, 2).getTime();
  const maxTs = yearConstraint
    ? new Date(yearConstraint, 11, 30).getTime()
    : new Date(2025, 11, 30).getTime();

  return fc.record({
    id: fc.constant(`expense-${vehicleId}-${expenseIndex}`),
    vehicleId: fc.constant(vehicleId),
    category: fc.constantFrom(...EXPENSE_CATEGORIES),
    expenseAmount: fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }),
    date: fc.integer({ min: minTs, max: maxTs }).map((ts) => new Date(ts)),
    mileage: fc.option(fc.integer({ min: 1000, max: 300000 }), { nil: null }),
    fuelAmount: fc.option(fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }), {
      nil: null,
    }),
    fuelType: fc.option(fc.constantFrom('Regular', 'Premium', 'Diesel'), { nil: null }),
    missedFillup: fc.boolean(),
  });
}

/** Generate a list of expenses for a vehicle. */
export function expenseListArb(
  vehicleId: string,
  opts?: { minLength?: number; maxLength?: number; yearConstraint?: number }
): fc.Arbitrary<TestExpense[]> {
  const min = opts?.minLength ?? 0;
  const max = opts?.maxLength ?? 10;
  return fc.integer({ min, max }).chain((len) => {
    if (len === 0) return fc.constant([] as TestExpense[]);
    const arbs: fc.Arbitrary<TestExpense>[] = [];
    for (let i = 0; i < len; i++) {
      arbs.push(expenseArb(vehicleId, i, opts?.yearConstraint));
    }
    return fc.tuple(...arbs).map((arr) => [...arr]);
  });
}

// ---------------------------------------------------------------------------
// In-memory DB helpers
// ---------------------------------------------------------------------------

export interface TestDb {
  sqlite: Database;
  drizzle: BunSQLiteDatabase<Record<string, unknown>>;
}

/** Create an in-memory SQLite DB with the full schema applied. */
export function createTestDb(): TestDb {
  const migrations = loadMigrations();
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  applyMigrationsUpTo(sqlite, migrations, migrations.length - 1);
  return { sqlite, drizzle: drizzle(sqlite) };
}

/** Insert a test user into the DB. */
export function seedUser(db: Database, user: TestUser): void {
  db.run(
    "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES (?, ?, ?, 'google', ?)",
    [user.id, user.email, user.displayName, `provider-${user.id}`]
  );
}

/** Insert a test vehicle into the DB. */
export function seedVehicle(db: Database, vehicle: TestVehicle): void {
  db.run(
    'INSERT INTO vehicles (id, user_id, make, model, year, current_insurance_policy_id) VALUES (?, ?, ?, ?, ?, ?)',
    [
      vehicle.id,
      vehicle.userId,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.currentInsurancePolicyId,
    ]
  );
}

/** Insert a test expense into the DB. */
export function seedExpense(db: Database, expense: TestExpense): void {
  const dateUnix = Math.floor(expense.date.getTime() / 1000);
  if (Number.isNaN(dateUnix)) {
    throw new Error(`Invalid date for expense ${expense.id}: ${expense.date}`);
  }
  db.run(
    'INSERT INTO expenses (id, vehicle_id, category, expense_amount, date, mileage, fuel_amount, fuel_type, missed_fillup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      expense.id,
      expense.vehicleId,
      expense.category,
      expense.expenseAmount,
      dateUnix,
      expense.mileage,
      expense.fuelAmount,
      expense.fuelType,
      expense.missedFillup ? 1 : 0,
    ]
  );
}

/** Insert a test insurance policy into the DB. */
export function seedInsurancePolicy(db: Database, policy: TestInsurancePolicy): void {
  db.run('INSERT INTO insurance_policies (id, company, is_active) VALUES (?, ?, ?)', [
    policy.id,
    policy.company,
    policy.isActive ? 1 : 0,
  ]);
}

// ---------------------------------------------------------------------------
// Vehicle Financing helpers
// ---------------------------------------------------------------------------
export interface TestVehicleFinancing {
  id: string;
  vehicleId: string;
  financingType: 'loan' | 'lease' | 'own';
  provider: string;
  originalAmount: number;
  currentBalance: number;
  apr: number | null;
  termMonths: number;
  startDate: Date;
  paymentAmount: number;
  isActive: boolean;
}

/** Insert a test vehicle financing record into the DB. */
export function seedVehicleFinancing(db: Database, fin: TestVehicleFinancing): void {
  const startDateUnix = Math.floor(fin.startDate.getTime() / 1000);
  db.run(
    'INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, current_balance, apr, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      fin.id,
      fin.vehicleId,
      fin.financingType,
      fin.provider,
      fin.originalAmount,
      fin.currentBalance,
      fin.apr,
      fin.termMonths,
      startDateUnix,
      fin.paymentAmount,
      fin.isActive ? 1 : 0,
    ]
  );
}

// ---------------------------------------------------------------------------
// Insurance Policy Vehicle helpers
// ---------------------------------------------------------------------------
export interface TestInsurancePolicyVehicle {
  policyId: string;
  termId: string;
  vehicleId: string;
}

/** Insert a test insurance policy vehicle junction record into the DB. */
export function seedInsurancePolicyVehicle(db: Database, row: TestInsurancePolicyVehicle): void {
  db.run(
    'INSERT INTO insurance_policy_vehicles (policy_id, term_id, vehicle_id) VALUES (?, ?, ?)',
    [row.policyId, row.termId, row.vehicleId]
  );
}

// ---------------------------------------------------------------------------
// DateRange helpers
// ---------------------------------------------------------------------------

/** Convert a year number to a DateRange (unix timestamps in seconds). */
export function yearToRange(year: number): { start: number; end: number } {
  return {
    start: Math.floor(new Date(year, 0, 1).getTime() / 1000),
    end: Math.floor(new Date(year + 1, 0, 1).getTime() / 1000),
  };
}
