import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '../db/schema.js';
import { BaseRepository } from '../lib/repositories/base.js';

// Test database configuration - use unique names to avoid conflicts
const getTestDbPath = () => `./test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`;

// Global test database instances
let testSqlite: Database | null = null;
let testDb: ReturnType<typeof drizzle> | null = null;
let currentTestDbPath: string | null = null;

export function setupTestDatabase() {
  // Don't recreate if already exists and healthy
  if (testDb && testSqlite) {
    try {
      // Test if database is still accessible
      testSqlite.query('SELECT 1').get();
      return testDb;
    } catch (_error) {
      // Database is closed, need to recreate
      teardownTestDatabase();
    }
  }

  // Create new test database with unique name
  currentTestDbPath = getTestDbPath();
  testSqlite = new Database(currentTestDbPath);

  // Configure for testing
  testSqlite.exec('PRAGMA journal_mode = MEMORY');
  testSqlite.exec('PRAGMA synchronous = OFF');
  testSqlite.exec('PRAGMA foreign_keys = ON');
  testSqlite.exec('PRAGMA temp_store = MEMORY');

  testDb = drizzle(testSqlite, { schema });

  // Run migrations
  try {
    migrate(testDb, { migrationsFolder: './drizzle' });
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }

  // Configure repositories to use test database
  BaseRepository.setDatabaseInstance(testDb);

  // Configure database service to use test database
  try {
    const { databaseService } = require('../lib/database.js');
    databaseService.setTestDatabase(testDb);
  } catch (_error) {
    // Ignore if module doesn't exist
  }

  // Configure Lucia provider to use test instance
  try {
    const { getTestLucia } = require('./lucia-test.js');
    const { setLucia } = require('../lib/auth/lucia-provider.js');
    setLucia(getTestLucia());
  } catch (_error) {
    // Ignore if modules don't exist
  }

  return testDb;
}

export function teardownTestDatabase() {
  // Reset repositories to use production database
  BaseRepository.resetDatabaseInstance();

  // Reset database service to use production database
  try {
    const { databaseService } = require('../lib/database.js');
    databaseService.setTestDatabase(null);
  } catch (_error) {
    // Ignore if module doesn't exist
  }

  // Reset Lucia provider to use production instance
  try {
    const { resetLucia } = require('../lib/auth/lucia-provider.js');
    resetLucia();
  } catch (_error) {
    // Ignore if module doesn't exist
  }

  // Reset test Lucia instance
  try {
    const { resetTestLucia } = require('./lucia-test.js');
    resetTestLucia();
  } catch (_error) {
    // Ignore if lucia-test module doesn't exist
  }

  // Close database connection
  if (testSqlite) {
    try {
      testSqlite.close();
    } catch (_error) {
      // Ignore errors when closing already closed database
    }
    testSqlite = null;
  }

  // Clean up test database file
  if (currentTestDbPath && existsSync(currentTestDbPath)) {
    try {
      unlinkSync(currentTestDbPath);
    } catch (_error) {
      // Ignore errors when deleting non-existent file
    }
  }

  testDb = null;
  currentTestDbPath = null;
}

export function getTestDatabase() {
  return testDb;
}

export function clearTestData() {
  if (!testDb) return;

  try {
    // Clear all tables in reverse dependency order
    testDb.delete(schema.sessions).run();
    testDb.delete(schema.expenses).run();
    testDb.delete(schema.vehicleFinancingPayments).run();
    testDb.delete(schema.vehicleFinancing).run();
    testDb.delete(schema.insurancePolicies).run();
    testDb.delete(schema.vehicles).run();
    testDb.delete(schema.users).run();
  } catch (error) {
    console.error('Error clearing test data:', error);
  }
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
  vehicleType: 'gas' as const,
  licensePlate: 'TEST123',
  nickname: 'Test Car',
  initialMileage: 25000,
  purchasePrice: 22000,
  purchaseDate: new Date('2020-03-15'),
};

export const testExpenseData = {
  tags: ['fuel'],
  category: 'fuel' as const,
  amount: 45.5,
  currency: 'USD',
  date: new Date('2024-01-15'),
  mileage: 25500,
  volume: 12.5,
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
