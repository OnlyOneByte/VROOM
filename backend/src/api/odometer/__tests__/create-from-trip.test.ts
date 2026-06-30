/**
 * Unit tests for OdometerRepository.createFromTrip (trips-location D2 — "reuse the odometer linkage").
 *
 * Contract: a trip's end reading writes an odometer_entries row so it feeds getCurrentOdometer + the
 * mileage-reminder axis — DEDUPED by (vehicleId, local calendar-day of recordedAt, odometer value): a
 * same-vehicle/same-day/same-reading entry already present (e.g. the user also logged it manually) is NOT
 * duplicated (returns null). A different reading, a different day, or a different vehicle DOES insert.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { OdometerRepository } from '../repository';

const USER_ID = 'u-cft';
const OTHER_USER = 'u-cft-2';
const VEHICLE_ID = 'v-cft';

let sqliteDb: Database;
let db: AppDatabase;
let repo: OdometerRepository;

function countEntries(vehicleId = VEHICLE_ID): number {
  return (
    sqliteDb
      .query('SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ?')
      .get(vehicleId) as {
      n: number;
    }
  ).n;
}

describe('OdometerRepository.createFromTrip (D2)', () => {
  const migrations = loadMigrations();

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(sqliteDb, migrations, migrations.length - 1);
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'c@x.com', 'C')`
    );
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${OTHER_USER}', 'o@x.com', 'O')`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
    );
    db = drizzle(sqliteDb, { schema });
    repo = new OdometerRepository(db);
  });

  afterEach(() => sqliteDb.close());

  const base = (over: Partial<{ odometer: number; recordedAt: Date }> = {}) => ({
    vehicleId: VEHICLE_ID,
    userId: USER_ID,
    odometer: 5000,
    recordedAt: new Date('2024-06-20T12:00:00.000Z'),
    ...over,
  });

  test('creates an odometer entry from a trip reading (feeds getCurrentOdometer)', async () => {
    const created = await repo.createFromTrip(base());
    expect(created).not.toBeNull();
    expect(created?.odometer).toBe(5000);
    expect(countEntries()).toBe(1);
    expect(await repo.getCurrentOdometer(VEHICLE_ID, USER_ID)).toBe(5000);
  });

  test('defaults a provenance note when none supplied', async () => {
    const created = await repo.createFromTrip(base());
    expect(created?.note).toBe('From trip');
  });

  test('DEDUPS a same (vehicle, day, reading) entry → returns null, no second row', async () => {
    await repo.createFromTrip(base());
    // Same day (different time-of-day), same reading → treated as the same observation.
    const dup = await repo.createFromTrip(
      base({ recordedAt: new Date('2024-06-20T20:30:00.000Z') })
    );
    expect(dup).toBeNull();
    expect(countEntries()).toBe(1);
  });

  test('a DIFFERENT reading on the same day DOES insert (not a dup)', async () => {
    await repo.createFromTrip(base({ odometer: 5000 }));
    const second = await repo.createFromTrip(base({ odometer: 5200 }));
    expect(second).not.toBeNull();
    expect(countEntries()).toBe(2);
    expect(await repo.getCurrentOdometer(VEHICLE_ID, USER_ID)).toBe(5200);
  });

  test('the SAME reading on a DIFFERENT day DOES insert (distinct observation)', async () => {
    await repo.createFromTrip(base({ recordedAt: new Date('2024-06-20T12:00:00.000Z') }));
    const nextDay = await repo.createFromTrip(
      base({ recordedAt: new Date('2024-06-21T12:00:00.000Z') })
    );
    expect(nextDay).not.toBeNull();
    expect(countEntries()).toBe(2);
  });

  test('dedup is userId-scoped — a foreign user’s same-day-same-reading row does NOT block this insert', async () => {
    // A foreign user's entry sharing the vehicleId + day + reading (pathological) must not dedup ours away.
    sqliteDb.run(
      `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
       VALUES ('odo-foreign', '${VEHICLE_ID}', '${OTHER_USER}', 5000, ${Math.floor(Date.UTC(2024, 5, 20, 12) / 1000)})`
    );
    const created = await repo.createFromTrip(base());
    expect(created, 'our insert is not blocked by a foreign user row').not.toBeNull();
  });

  // C215 (guard): D2's WHOLE POINT is "avoid the divergent double-count when the user ALSO logs odometer
  // manually". The C213 tests only covered trip→trip dedup; this pins the actual scenario — a trip dedups
  // against a MANUALLY-created entry (the normal odometer create path, note=null) for the same (vehicle,
  // day, reading). A regression that only deduped trip-origin entries would silently double-count here.
  test('dedups against a MANUALLY-logged same-day-same-reading entry (the D2 double-count scenario)', async () => {
    // The user already logged 5000 today via the regular odometer create (no provenance note).
    await repo.create({
      vehicleId: VEHICLE_ID,
      userId: USER_ID,
      odometer: 5000,
      recordedAt: new Date('2024-06-20T09:00:00.000Z'),
      note: null,
    });
    // A trip that same day at the same reading must NOT add a second odometer entry.
    const fromTrip = await repo.createFromTrip(
      base({ recordedAt: new Date('2024-06-20T18:00:00.000Z') })
    );
    expect(fromTrip, 'a trip reading matching a manual entry dedups').toBeNull();
    expect(countEntries()).toBe(1);
  });

  // C215 (guard): the dedup window is the LOCAL calendar day (getFullYear/Month/Date), matching R5's
  // local-day semantics — NOT a UTC day. Two readings straddling UTC-midnight on the same local day dedup;
  // and the cross-day case inserts. Pins that the window can't silently regress to a UTC slice (the #87/#106
  // date-seam class). (Asserted relative to the host TZ so it holds regardless of the runner's zone.)
  test('the dedup window is the LOCAL calendar day, not a UTC slice (R5)', async () => {
    const first = new Date('2024-06-20T12:00:00.000Z');
    await repo.createFromTrip(base({ recordedAt: first }));
    // Same LOCAL day as `first`, a few hours later → dedup (one entry).
    const sameLocalDay = new Date(first.getFullYear(), first.getMonth(), first.getDate(), 23, 0, 0);
    const dup = await repo.createFromTrip(base({ recordedAt: sameLocalDay }));
    expect(dup, 'same local day + same reading dedups').toBeNull();
    // The NEXT local day at the same reading is a distinct observation → inserts.
    const nextLocalDay = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() + 1,
      1,
      0,
      0
    );
    const next = await repo.createFromTrip(base({ recordedAt: nextLocalDay }));
    expect(next, 'next local day inserts').not.toBeNull();
    expect(countEntries()).toBe(2);
  });
});
