/**
 * Migration 0004: Vehicle Energy Tracking Flags
 *
 * Adds `track_fuel` (NOT NULL boolean, default true) and `track_charging`
 * (NOT NULL boolean, default false) columns to the `vehicles` table.
 * Data migration sets flags based on existing `vehicle_type`.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0004: Vehicle Energy Tracking Flags', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('vehicles table has track_fuel and track_charging columns', () => {
    applyMigrationsUpTo(db, migrations, 4);

    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('track_fuel');
    expect(cols).toContain('track_charging');
  });

  test('track_fuel defaults to true (1) and track_charging defaults to false (0)', () => {
    applyMigrationsUpTo(db, migrations, 4);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'g1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );

    const vehicle = db
      .query("SELECT track_fuel, track_charging FROM vehicles WHERE id = 'v1'")
      .get() as {
      track_fuel: number;
      track_charging: number;
    };
    expect(vehicle.track_fuel).toBe(1);
    expect(vehicle.track_charging).toBe(0);
  });

  test('data migration sets electric vehicles to trackFuel=false, trackCharging=true', () => {
    applyMigrationsUpTo(db, migrations, 3);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'g1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, vehicle_type) VALUES ('v-ev', 'u1', 'Tesla', 'Model 3', 2024, 'electric')"
    );

    applyMigration(db, migrations[4]);

    const vehicle = db
      .query("SELECT track_fuel, track_charging FROM vehicles WHERE id = 'v-ev'")
      .get() as {
      track_fuel: number;
      track_charging: number;
    };
    expect(vehicle.track_fuel).toBe(0);
    expect(vehicle.track_charging).toBe(1);
  });

  test('data migration sets hybrid vehicles to trackFuel=true, trackCharging=true', () => {
    applyMigrationsUpTo(db, migrations, 3);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'g1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, vehicle_type) VALUES ('v-hyb', 'u1', 'Toyota', 'Prius', 2023, 'hybrid')"
    );

    applyMigration(db, migrations[4]);

    const vehicle = db
      .query("SELECT track_fuel, track_charging FROM vehicles WHERE id = 'v-hyb'")
      .get() as {
      track_fuel: number;
      track_charging: number;
    };
    expect(vehicle.track_fuel).toBe(1);
    expect(vehicle.track_charging).toBe(1);
  });

  test('data migration keeps gas vehicles at defaults (trackFuel=true, trackCharging=false)', () => {
    applyMigrationsUpTo(db, migrations, 3);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'g1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, vehicle_type) VALUES ('v-gas', 'u1', 'Ford', 'F-150', 2022, 'gas')"
    );

    applyMigration(db, migrations[4]);

    const vehicle = db
      .query("SELECT track_fuel, track_charging FROM vehicles WHERE id = 'v-gas'")
      .get() as {
      track_fuel: number;
      track_charging: number;
    };
    expect(vehicle.track_fuel).toBe(1);
    expect(vehicle.track_charging).toBe(0);
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 3);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[4]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    const user = db.query("SELECT * FROM users WHERE id = 'u1'").get() as { email: string };
    expect(user.email).toBe('test@example.com');

    // Seed vehicle has default vehicle_type='gas', so it keeps defaults
    const vehicle = db
      .query("SELECT track_fuel, track_charging FROM vehicles WHERE id = 'v1'")
      .get() as {
      track_fuel: number;
      track_charging: number;
    };
    expect(vehicle.track_fuel).toBe(1);
    expect(vehicle.track_charging).toBe(0);
  });
});
