import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '../db/schema.js';
import { existsSync, unlinkSync } from 'fs';
import { BaseRepository } from '../lib/repositories/base.js';
import { UserRepository } from '../lib/repositories/user.js';

// Test database configuration
const TEST_DB_PATH = './test.db';

// Create test database instance
let testSqlite: Database;
let testDb: ReturnType<typeof drizzle>;

export function setupTestDatabase() {
  // Remove existing test database
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  // Create new test database
  testSqlite = new Database(TEST_DB_PATH);
  
  // Configure for testing
  testSqlite.exec('PRAGMA journal_mode = MEMORY');
  testSqlite.exec('PRAGMA synchronous = OFF');
  testSqlite.exec('PRAGMA foreign_keys = ON');
  
  testDb = drizzle(testSqlite, { schema });
  
  // Run migrations
  migrate(testDb, { migrationsFolder: './drizzle' });
  
  // Configure repositories to use test database
  BaseRepository.setDatabaseInstance(testDb);
  UserRepository.setDatabaseInstance(testDb);
  
  return testDb;
}

export function teardownTestDatabase() {
  if (testSqlite) {
    testSqlite.close();
  }
  
  // Clean up test database file
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
}

export function getTestDatabase() {
  return testDb;
}

// Test data factories
export const testUserData = {
  email: 'test@example.com',
  displayName: 'Test User',
  provider: 'google' as const,
  providerId: 'test-provider-123',
};

export const testVehicleData = {
  make: 'Toyota',
  model: 'Camry',
  year: 2020,
  licensePlate: 'TEST123',
  nickname: 'Test Car',
  initialMileage: 25000,
  purchasePrice: 22000,
  purchaseDate: new Date('2020-03-15'),
};

export const testExpenseData = {
  type: 'fuel' as const,
  category: 'operating' as const,
  amount: 45.50,
  currency: 'USD',
  date: new Date('2024-01-15'),
  mileage: 25500,
  gallons: 12.5,
  description: 'Shell Gas Station',
};

export const testLoanData = {
  lender: 'Test Bank',
  originalAmount: 20000,
  currentBalance: 15000,
  apr: 4.5,
  termMonths: 60,
  startDate: new Date('2020-03-15'),
  paymentAmount: 372.86,
  paymentFrequency: 'monthly' as const,
  paymentDayOfMonth: 15,
};

export const testInsuranceData = {
  company: 'Test Insurance Co',
  policyNumber: 'TEST123456',
  totalCost: 1200,
  termLengthMonths: 6,
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-06-30'),
  monthlyCost: 200,
};