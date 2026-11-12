import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { OdometerRepository } from '../repository';

const USER_ID = 'u-page';
const VEHICLE_ID = 'v-page';

let sqliteDb: Database;
let db: AppDatabase;
let repo: OdometerRepository;
let counter = 0;

function insertEntry(odometer: number, vehicleId = VEHICLE_ID, userId = USER_ID): void {
  sqliteDb.run(
    `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
     VALUES ('odo-page-${++counter}', '${vehicleId}', '${userId}', ${odometer}, ${1700000000 + counter})`
  );
}

describe('OdometerRepository.findByVehicleIdPaginated', () => {
  const migrations = loadMigrations();

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(sqliteDb, migrations, migrations.length - 1);
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'page@test.com', 'Page User')`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Honda', 'Civic', 2023)`
    );
    db = drizzle(sqliteDb, { schema });
    repo = new OdometerRepository(db);
    counter = 0;
  });

  afterEach(() => sqliteDb.close());

  test('returns the vehicle entries newest-first with an accurate totalCount', async () => {
    insertEntry(10000);
    insertEntry(20000);
    insertEntry(30000);
    const { data, totalCount } = await repo.findByVehicleIdPaginated(VEHICLE_ID, USER_ID, 50, 0);
    expect(totalCount).toBe(3);
    expect(data.map((d) => d.odometer)).toEqual([30000, 20000, 10000]);
  });

  test('honors limit + offset against the same total', async () => {
    for (let i = 1; i <= 5; i++) insertEntry(i * 1000);
    const page = await repo.findByVehicleIdPaginated(VEHICLE_ID, USER_ID, 2, 2);
    expect(page.totalCount).toBe(5);
    expect(page.data).toHaveLength(2);
  });

  test('is userId-scoped — another user’s same-vehicleId rows never leak into data or count', async () => {
    const OTHER_USER = 'u-page-other';
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${OTHER_USER}', 'po@test.com', 'Other')`
    );
    insertEntry(11000, VEHICLE_ID, USER_ID);
    insertEntry(99999, VEHICLE_ID, OTHER_USER);

    const { data, totalCount } = await repo.findByVehicleIdPaginated(VEHICLE_ID, USER_ID, 50, 0);
    expect(totalCount).toBe(1);
    expect(data).toHaveLength(1);
    expect(data[0]?.odometer).toBe(11000);
    expect(data.some((d) => d.odometer === 99999)).toBe(false);
  });
});
