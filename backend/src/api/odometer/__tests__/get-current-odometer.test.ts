/**
 * Unit tests for OdometerRepository.getCurrentOdometer (maintenance-schedule T2 / design D2).
 *
 * Contract: the current odometer is MAX(odometer) across BOTH sources
 * (`expenses.mileage` + `odometer_entries.odometer`) — by VALUE, not by date —
 * and null when the vehicle has no reading on either source. This reconciles the
 * fuel-only `vehicle-stats.currentMileage` (which ignores manual entries and
 * non-fuel mileage) for the mileage trigger.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { OdometerRepository } from '../repository';

const USER_ID = 'u-cur';
const VEHICLE_ID = 'v-cur';
const OTHER_VEHICLE_ID = 'v-other';

let sqliteDb: Database;
let db: AppDatabase;
let repo: OdometerRepository;
let expenseCounter = 0;
let odometerCounter = 0;

function insertExpenseWithMileage(mileage: number, vehicleId = VEHICLE_ID): void {
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, mileage)
     VALUES ('exp-cur-${++expenseCounter}', '${vehicleId}', '${USER_ID}', 'fuel', 1700000000, 50.0, ${mileage})`
  );
}

function insertExpenseWithoutMileage(vehicleId = VEHICLE_ID): void {
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES ('exp-cur-${++expenseCounter}', '${vehicleId}', '${USER_ID}', 'maintenance', 1700000000, 100.0)`
  );
}

function insertOdometerEntry(odometer: number, vehicleId = VEHICLE_ID): void {
  sqliteDb.run(
    `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
     VALUES ('odo-cur-${++odometerCounter}', '${vehicleId}', '${USER_ID}', ${odometer}, 1700000000)`
  );
}

describe('OdometerRepository.getCurrentOdometer', () => {
  const migrations = loadMigrations();

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(sqliteDb, migrations, migrations.length - 1);
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'cur@test.com', 'Cur User')`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Honda', 'Civic', 2023)`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${OTHER_VEHICLE_ID}', '${USER_ID}', 'Toyota', 'Corolla', 2021)`
    );
    db = drizzle(sqliteDb, { schema });
    repo = new OdometerRepository(db);
    expenseCounter = 0;
    odometerCounter = 0;
  });

  afterEach(() => {
    sqliteDb.close();
  });

  test('returns null when the vehicle has no readings on either source', async () => {
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBeNull();
  });

  test('returns the max expense mileage when only expenses have readings', async () => {
    insertExpenseWithMileage(12000);
    insertExpenseWithMileage(15000);
    insertExpenseWithMileage(9000);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(15000);
  });

  test('returns the max manual entry when only manual entries exist', async () => {
    insertOdometerEntry(30000);
    insertOdometerEntry(42000);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(42000);
  });

  test('takes the max ACROSS both sources by value, not by recency', async () => {
    // Manual entry has the higher value; an expense (different source) is lower.
    insertExpenseWithMileage(20000);
    insertOdometerEntry(55000);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(55000);
  });

  test('max can come from the expense source when it is higher', async () => {
    insertExpenseWithMileage(88000);
    insertOdometerEntry(40000);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(88000);
  });

  test('ignores expenses with NULL mileage (non-fuel / no reading)', async () => {
    insertExpenseWithoutMileage();
    insertExpenseWithMileage(7000);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(7000);
  });

  test('is scoped per vehicle — other vehicles never leak in', async () => {
    insertExpenseWithMileage(10000, VEHICLE_ID);
    insertOdometerEntry(11000, VEHICLE_ID);
    // Much larger readings on a different vehicle must not bleed into the result.
    insertExpenseWithMileage(999999, OTHER_VEHICLE_ID);
    insertOdometerEntry(888888, OTHER_VEHICLE_ID);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(11000);
  });

  test('handles a zero reading distinctly from no reading', async () => {
    insertOdometerEntry(0);
    expect(await repo.getCurrentOdometer(VEHICLE_ID)).toBe(0);
  });
});
