import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, applyMigrationsUpTo, loadMigrations } from './migration-helpers';

const NOON = Math.floor(Date.UTC(2024, 5, 20, 12) / 1000);
const EVENING = Math.floor(Date.UTC(2024, 5, 20, 20) / 1000);
const NEXT_DAY = Math.floor(Date.UTC(2024, 5, 21, 12) / 1000);

describe('Migration 0007: trip readings are linked to their trips', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 6);
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@x.com', 'A')");
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@x.com', 'B')");
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2', 'u2', 'Honda', 'Civic', 2021)"
    );
  });

  afterEach(() => {
    db.close();
  });

  function trip(
    id: string,
    vehicleId: string,
    userId: string,
    end: number,
    at: number,
    created = at
  ) {
    db.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_at)
       VALUES (?, ?, ?, 1000, ?, 'business', ?, ?)`,
      [id, vehicleId, userId, end, at, created]
    );
  }

  function entry(
    id: string,
    vehicleId: string,
    userId: string,
    odometer: number,
    at: number,
    note: string | null
  ) {
    db.run(
      'INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at, note) VALUES (?, ?, ?, ?, ?, ?)',
      [id, vehicleId, userId, odometer, at, note]
    );
  }

  function links(): Record<string, string | null> {
    const rows = db.query('SELECT id, source_trip_id FROM odometer_entries ORDER BY id').all() as {
      id: string;
      source_trip_id: string | null;
    }[];
    return Object.fromEntries(rows.map((row) => [row.id, row.source_trip_id]));
  }

  test('links each "From trip" reading to the trip with the same vehicle, value and day', () => {
    trip('t1', 'v1', 'u1', 1080, NOON);
    entry('o1', 'v1', 'u1', 1080, EVENING, 'From trip');

    applyMigration(db, migrations[7]);

    expect(links()).toEqual({ o1: 't1' });
  });

  test('picks the earliest trip when two trips share the reading', () => {
    trip('t-late', 'v1', 'u1', 1080, NOON, NOON + 60);
    trip('t-early', 'v1', 'u1', 1080, NOON, NOON);
    entry('o1', 'v1', 'u1', 1080, NOON, 'From trip');

    applyMigration(db, migrations[7]);

    expect(links()).toEqual({ o1: 't-early' });
  });

  test('leaves manual readings, other days, other values and other users unlinked', () => {
    trip('t1', 'v1', 'u1', 1080, NOON);
    trip('t2', 'v2', 'u2', 1080, NOON);
    entry('manual', 'v1', 'u1', 1080, NOON, 'Oil change');
    entry('other-day', 'v1', 'u1', 1080, NEXT_DAY, 'From trip');
    entry('other-value', 'v1', 'u1', 1081, NOON, 'From trip');
    entry('other-user', 'v2', 'u2', 1080, NOON, 'From trip');

    applyMigration(db, migrations[7]);

    expect(links()).toEqual({
      manual: null,
      'other-day': null,
      'other-user': 't2',
      'other-value': null,
    });
  });
});
