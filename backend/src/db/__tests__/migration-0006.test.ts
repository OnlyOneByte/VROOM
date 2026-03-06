/**
 * Migration 0006: Unit Preferences Consolidation
 *
 * Adds `unit_preferences` JSON column to `vehicles` and `user_settings`,
 * backfills from user_settings separate columns, then drops the old
 * `distance_unit`, `volume_unit`, `charge_unit` columns from `user_settings`.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

// Feature: unit-aware-display
// Arbitraries for unit enum values
const distanceUnitArb = fc.constantFrom('miles', 'kilometers');
const volumeUnitArb = fc.constantFrom('gallons_us', 'gallons_uk', 'liters');
const chargeUnitArb = fc.constantFrom('kwh');

describe('Migration 0006: Unit Preferences Consolidation', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('adds unit_preferences column to vehicles', () => {
    applyMigrationsUpTo(db, migrations, 6);
    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('unit_preferences');
  });

  test('adds unit_preferences column to user_settings', () => {
    applyMigrationsUpTo(db, migrations, 6);
    const cols = getColumnNames(db, 'user_settings');
    expect(cols).toContain('unit_preferences');
  });

  test('removes old separate unit columns from user_settings', () => {
    applyMigrationsUpTo(db, migrations, 6);
    const cols = getColumnNames(db, 'user_settings');
    expect(cols).not.toContain('distance_unit');
    expect(cols).not.toContain('volume_unit');
    expect(cols).not.toContain('charge_unit');
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 5);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[6]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
  });

  test('vehicles without user_settings get schema defaults', () => {
    applyMigrationsUpTo(db, migrations, 5);
    // Insert user and vehicle but no user_settings row
    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );

    applyMigration(db, migrations[6]);

    const vehicle = db.query("SELECT unit_preferences FROM vehicles WHERE id = 'v1'").get() as {
      unit_preferences: string;
    };
    const prefs = JSON.parse(vehicle.unit_preferences);
    expect(prefs.distanceUnit).toBe('miles');
    expect(prefs.volumeUnit).toBe('gallons_us');
    expect(prefs.chargeUnit).toBe('kwh');
  });

  // Feature: unit-aware-display, Property 14: User settings migration consolidates columns
  // **Validates: Requirements 10.2, 10.3, 10.4**
  describe('Property 14: User settings migration consolidates columns', () => {
    test('separate unit columns are consolidated into unitPreferences JSON', () => {
      fc.assert(
        fc.property(
          distanceUnitArb,
          volumeUnitArb,
          chargeUnitArb,
          (distanceUnit, volumeUnit, chargeUnit) => {
            // Fresh DB for each run
            const testDb = new Database(':memory:');
            testDb.run('PRAGMA foreign_keys = ON');

            try {
              // Apply migrations up to 5 (before 0006)
              applyMigrationsUpTo(testDb, migrations, 5);

              // Seed user and user_settings with specific separate column values
              testDb.run(
                "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'a@b.com', 'Test', 'google', 'g1')"
              );
              testDb.run(
                `INSERT INTO user_settings (id, user_id, distance_unit, volume_unit, charge_unit) VALUES ('s1', 'u1', '${distanceUnit}', '${volumeUnit}', '${chargeUnit}')`
              );

              // Verify old columns exist before migration
              const colsBefore = getColumnNames(testDb, 'user_settings');
              expect(colsBefore).toContain('distance_unit');
              expect(colsBefore).toContain('volume_unit');
              expect(colsBefore).toContain('charge_unit');

              // Apply migration 0006
              applyMigration(testDb, migrations[6]);

              // Verify unit_preferences JSON contains the same values
              const row = testDb
                .query("SELECT unit_preferences FROM user_settings WHERE user_id = 'u1'")
                .get() as { unit_preferences: string };
              const prefs = JSON.parse(row.unit_preferences);
              expect(prefs.distanceUnit).toBe(distanceUnit);
              expect(prefs.volumeUnit).toBe(volumeUnit);
              expect(prefs.chargeUnit).toBe(chargeUnit);

              // Verify old separate columns are gone
              const colsAfter = getColumnNames(testDb, 'user_settings');
              expect(colsAfter).not.toContain('distance_unit');
              expect(colsAfter).not.toContain('volume_unit');
              expect(colsAfter).not.toContain('charge_unit');
              expect(colsAfter).toContain('unit_preferences');
            } finally {
              testDb.close();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // Feature: unit-aware-display, Property 15: Migration backfills from user settings
  // **Validates: Requirements 9.1**
  describe('Property 15: Migration backfills from user settings', () => {
    test('vehicle unitPreferences matches owning user settings after migration', () => {
      fc.assert(
        fc.property(
          distanceUnitArb,
          volumeUnitArb,
          chargeUnitArb,
          (distanceUnit, volumeUnit, chargeUnit) => {
            const testDb = new Database(':memory:');
            testDb.run('PRAGMA foreign_keys = ON');

            try {
              applyMigrationsUpTo(testDb, migrations, 5);

              // Seed user, user_settings with specific units, and a vehicle
              testDb.run(
                "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'a@b.com', 'Test', 'google', 'g1')"
              );
              testDb.run(
                `INSERT INTO user_settings (id, user_id, distance_unit, volume_unit, charge_unit) VALUES ('s1', 'u1', '${distanceUnit}', '${volumeUnit}', '${chargeUnit}')`
              );
              testDb.run(
                "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Honda', 'Civic', 2023)"
              );

              // Apply migration 0006
              applyMigration(testDb, migrations[6]);

              // Verify vehicle's unit_preferences matches user's settings
              const vehicle = testDb
                .query("SELECT unit_preferences FROM vehicles WHERE id = 'v1'")
                .get() as { unit_preferences: string };
              const prefs = JSON.parse(vehicle.unit_preferences);
              expect(prefs.distanceUnit).toBe(distanceUnit);
              expect(prefs.volumeUnit).toBe(volumeUnit);
              expect(prefs.chargeUnit).toBe(chargeUnit);
            } finally {
              testDb.close();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // Feature: unit-aware-display, Property 16: Migration preserves existing data
  // **Validates: Requirements 9.3**
  describe('Property 16: Migration preserves existing data', () => {
    test('expense and odometer numeric values are unchanged after migration', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0.01, max: 5000, noNaN: true, noDefaultInfinity: true }),
          fc.integer({ min: 1, max: 500000 }),
          fc.integer({ min: 1, max: 500000 }),
          (expenseAmount, fuelAmount, mileage, odometer) => {
            const testDb = new Database(':memory:');
            testDb.run('PRAGMA foreign_keys = ON');

            try {
              applyMigrationsUpTo(testDb, migrations, 5);

              // Seed user, vehicle, expense with specific numeric values
              testDb.run(
                "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'a@b.com', 'Test', 'google', 'g1')"
              );
              testDb.run(
                "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
              );
              testDb.run(
                `INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, fuel_amount, mileage) VALUES ('e1', 'v1', 'fuel', 1700000000, ${expenseAmount}, ${fuelAmount}, ${mileage})`
              );
              testDb.run(
                `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('o1', 'v1', 'u1', ${odometer}, 1700000000)`
              );

              // Apply migration 0006
              applyMigration(testDb, migrations[6]);

              // Verify expense numeric values are unchanged
              const expense = testDb.query("SELECT * FROM expenses WHERE id = 'e1'").get() as {
                expense_amount: number;
                fuel_amount: number;
                mileage: number;
              };
              expect(expense.expense_amount).toBe(expenseAmount);
              expect(expense.fuel_amount).toBe(fuelAmount);
              expect(expense.mileage).toBe(mileage);

              // Verify odometer entry value is unchanged
              const entry = testDb
                .query("SELECT * FROM odometer_entries WHERE id = 'o1'")
                .get() as { odometer: number };
              expect(entry.odometer).toBe(odometer);
            } finally {
              testDb.close();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
