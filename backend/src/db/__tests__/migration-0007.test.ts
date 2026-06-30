/**
 * Migration 0007: add the `trips` table (trips-location spec T1, design §1).
 *
 * A fully ADDITIVE migration — a single `CREATE TABLE trips` + a `trips_vehicle_date_idx` index (the
 * 0003-class additive shape, NOT the 0004 rebuild footgun). It creates a brand-new table, so it touches
 * NO existing row: pre-0007 data must survive byte-for-byte. These tests are the T1 proof gate:
 *   - the table exists on a fresh apply with the design §1 column set + NOT-NULL shape,
 *   - the composite (vehicle_id, trip_date) index exists (the odometer-index read pattern),
 *   - the vehicle_id / user_id FKs are ON DELETE CASCADE (a trip is owned data — deleting its vehicle or
 *     user must not orphan it; NORTH_STAR #2 tenant hygiene),
 *   - applying 0007 over a populated pre-0007 DB leaves every prior row untouched (additive = zero data risk).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  getIndexNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0007: trips table (trips-location T1)', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates the trips table with the design §1 column set', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'trips').sort();
    expect(cols).toEqual(
      [
        'id',
        'vehicle_id',
        'user_id',
        'start_odometer',
        'end_odometer',
        'purpose',
        'trip_date',
        'start_location',
        'end_location',
        'note',
        'created_at',
        'updated_at',
      ].sort()
    );
  });

  test('the odometer/purpose/date core columns are NOT NULL; locations + note are nullable (D5)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const info = db.query(`PRAGMA table_info('trips')`).all() as {
      name: string;
      notnull: number;
    }[];
    const notnull = (name: string) => info.find((c) => c.name === name)?.notnull;
    // Required core (R2 odometer pair, D4 purpose, R5 date):
    expect(notnull('start_odometer')).toBe(1);
    expect(notnull('end_odometer')).toBe(1);
    expect(notnull('purpose')).toBe(1);
    expect(notnull('trip_date')).toBe(1);
    expect(notnull('vehicle_id')).toBe(1);
    expect(notnull('user_id')).toBe(1);
    // Optional v1 free-text (D5 — no GPS, labels optional):
    expect(notnull('start_location')).toBe(0);
    expect(notnull('end_location')).toBe(0);
    expect(notnull('note')).toBe(0);
  });

  test('creates the composite trips_vehicle_date_idx', () => {
    applyMigrationsUpTo(db, migrations, 7);
    expect(getIndexNames(db, 'trips')).toContain('trips_vehicle_date_idx');
  });

  test('a trip row inserts and reads back (the additive table is live)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    seedCoreData(db);
    db.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
       VALUES ('t1', 'v1', 'u1', 1000, 1080, 'business', 1700000000)`
    );
    const row = db.query('SELECT * FROM trips WHERE id = ?').get('t1') as {
      vehicle_id: string;
      user_id: string;
      start_odometer: number;
      end_odometer: number;
      purpose: string;
      start_location: string | null;
    };
    expect(row.vehicle_id).toBe('v1');
    expect(row.user_id).toBe('u1');
    expect(row.start_odometer).toBe(1000);
    expect(row.end_odometer).toBe(1080);
    expect(row.purpose).toBe('business');
    expect(row.start_location).toBeNull(); // optional, omitted on insert
  });

  test('deleting the owning vehicle CASCADES to its trips (no orphan)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    seedCoreData(db);
    db.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
       VALUES ('t1', 'v1', 'u1', 1000, 1080, 'business', 1700000000)`
    );
    expect(countRows(db, 'trips')).toBe(1);
    db.run("DELETE FROM vehicles WHERE id = 'v1'");
    expect(countRows(db, 'trips')).toBe(0); // FK ON DELETE CASCADE fired
  });

  test('deleting the owning user CASCADES to its trips (no orphan)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    seedCoreData(db);
    db.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
       VALUES ('t1', 'v1', 'u1', 1000, 1080, 'commute', 1700000000)`
    );
    expect(countRows(db, 'trips')).toBe(1);
    // Deleting the user cascades to vehicles AND directly to trips (both FKs cascade).
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(countRows(db, 'trips')).toBe(0);
  });

  test('applying 0007 over a populated pre-0007 DB leaves prior data untouched (additive)', () => {
    // Seed at the pre-0007 state (migrations 0..6) with a user + vehicle + expense, then apply 0007.
    applyMigrationsUpTo(db, migrations, 6);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[7]);

    // The new table exists and is empty; every prior row survives unchanged.
    expect(countRows(db, 'trips')).toBe(0);
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
    const expense = db.query("SELECT expense_amount FROM expenses WHERE id = 'e1'").get() as {
      expense_amount: number;
    };
    expect(expense.expense_amount).toBe(45.5); // pre-existing money value intact
  });

  test('double-applying 0007 is rejected (CREATE TABLE is not idempotent — guards against a re-run)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    // A second apply of the same CREATE TABLE must throw (table already exists) — proves the journal,
    // not a silent IF-NOT-EXISTS, is the single-apply authority (mirrors migration-0006's intent).
    expect(() => applyMigration(db, migrations[7])).toThrow();
  });
});
