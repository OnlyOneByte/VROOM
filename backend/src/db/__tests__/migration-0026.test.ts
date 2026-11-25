import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0026: drivers for car-share tracking', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 25);
    seedCoreData(db);
    applyMigration(db, migrations[26]);
  });

  afterEach(() => {
    db.close();
  });

  test('existing cars keep car sharing off and existing entries stay unattributed', () => {
    expect(db.query("SELECT car_share_enabled FROM vehicles WHERE id = 'v1'").get()).toEqual({
      car_share_enabled: 0,
    });
    expect(db.query("SELECT paid_by_driver_id FROM expenses WHERE id = 'e1'").get()).toEqual({
      paid_by_driver_id: null,
    });
    expect(getColumnNames(db, 'trips')).toContain('driver_id');
    expect(getColumnNames(db, 'odometer_entries')).toContain('driver_id');
  });

  test('removing a driver leaves their entries in place, unattributed', () => {
    db.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, user_id, name) VALUES ('d1', 'v1', 'u1', 'Test')"
    );
    db.run("UPDATE expenses SET paid_by_driver_id = 'd1' WHERE id = 'e1'");
    db.run(
      "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at, driver_id) VALUES ('o1', 'v1', 'u1', 1000, 1700000000, 'd1')"
    );
    db.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, driver_id) VALUES ('t1', 'v1', 'u1', 900, 1000, 'personal', 1700000000, 'd1')"
    );
    db.run("DELETE FROM vehicle_drivers WHERE id = 'd1'");
    expect(db.query("SELECT paid_by_driver_id FROM expenses WHERE id = 'e1'").get()).toEqual({
      paid_by_driver_id: null,
    });
    expect(db.query("SELECT driver_id FROM odometer_entries WHERE id = 'o1'").get()).toEqual({
      driver_id: null,
    });
    expect(db.query("SELECT driver_id FROM trips WHERE id = 't1'").get()).toEqual({
      driver_id: null,
    });
  });

  test('a person is one driver per car, and guests can share a name', () => {
    db.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, user_id, name) VALUES ('d1', 'v1', 'u1', 'Test')"
    );
    expect(() =>
      db.run(
        "INSERT INTO vehicle_drivers (id, vehicle_id, user_id, name) VALUES ('d2', 'v1', 'u1', 'Again')"
      )
    ).toThrow();
    db.run("INSERT INTO vehicle_drivers (id, vehicle_id, name) VALUES ('g1', 'v1', 'Riley')");
    db.run("INSERT INTO vehicle_drivers (id, vehicle_id, name) VALUES ('g2', 'v1', 'Riley')");
    db.run("DELETE FROM vehicles WHERE id = 'v1'");
    expect(db.query('SELECT count(*) AS n FROM vehicle_drivers').get()).toEqual({ n: 0 });
  });
});
