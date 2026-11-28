import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { EXPENSE_CATEGORIES } from '../../../db/types';

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
}

export interface TestExpense {
  id: string;
  vehicleId: string;
  userId?: string;
  category: string;
  expenseAmount: number;
  date: Date;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  missedFillup: boolean;
}

export interface TestInsurancePolicy {
  id: string;
  userId: string;
  company: string;
  isActive: boolean;
}

export function userArb(index: number): fc.Arbitrary<TestUser> {
  return fc.constant({
    id: `user-${index}`,
    email: `user${index}@test.com`,
    displayName: `Test User ${index}`,
  });
}

export function vehicleArb(userId: string, vehicleIndex: number): fc.Arbitrary<TestVehicle> {
  return fc.record({
    id: fc.constant(`vehicle-${userId}-${vehicleIndex}`),
    userId: fc.constant(userId),
    make: fc.constantFrom('Toyota', 'Honda', 'Ford', 'BMW', 'Tesla'),
    model: fc.constantFrom('Camry', 'Civic', 'F-150', 'X3', 'Model 3'),
    year: fc.integer({ min: 2000, max: 2025 }),
  });
}

export function expenseArb(
  vehicleId: string,
  expenseIndex: number,
  yearConstraint?: number
): fc.Arbitrary<TestExpense> {
  const minTs = yearConstraint
    ? new Date(Date.UTC(yearConstraint, 0, 2)).getTime()
    : new Date(Date.UTC(2020, 0, 2)).getTime();
  const maxTs = yearConstraint
    ? new Date(Date.UTC(yearConstraint, 11, 30)).getTime()
    : new Date(Date.UTC(2025, 11, 30)).getTime();

  return fc.record({
    id: fc.constant(`expense-${vehicleId}-${expenseIndex}`),
    vehicleId: fc.constant(vehicleId),
    category: fc.constantFrom(...EXPENSE_CATEGORIES),
    expenseAmount: fc.integer({ min: 1, max: 1_000_000 }),
    date: fc.integer({ min: minTs, max: maxTs }).map((ts) => new Date(ts)),
    mileage: fc.option(fc.integer({ min: 1000, max: 300000 }), { nil: null }),
    volume: fc.option(fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }), {
      nil: null,
    }),
    fuelType: fc.option(fc.constantFrom('Regular', 'Premium', 'Diesel'), { nil: null }),
    missedFillup: fc.boolean(),
  });
}

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

export interface TestDb {
  sqlite: Database;
  drizzle: AppDatabase;
}

export function createTestDb(): TestDb {
  const migrations = loadMigrations();
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  applyMigrationsUpTo(sqlite, migrations, migrations.length - 1);
  return { sqlite, drizzle: drizzle(sqlite, { schema }) };
}

export interface TestVehicleFinancing {
  id: string;
  vehicleId: string;
  financingType: 'loan' | 'lease' | 'own';
  provider: string;
  originalAmount: number;
  apr: number | null;
  termMonths: number;
  startDate: Date;
  paymentAmount: number;
  isActive: boolean;
}

export interface TestInsuranceTermVehicle {
  termId: string;
  vehicleId: string;
}

export function yearToRange(year: number): { start: number; end: number } {
  return {
    start: Math.floor(new Date(Date.UTC(year, 0, 1)).getTime() / 1000),
    end: Math.floor(new Date(Date.UTC(year + 1, 0, 1)).getTime() / 1000),
  };
}
