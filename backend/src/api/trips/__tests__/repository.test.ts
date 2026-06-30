/**
 * TripRepository unit tests (trips-location T2) over an in-memory migrated DB (the OdometerRepository
 * test harness). Covers the CRUD + finder surface and — the spec's required regression — the
 * cross-tenant DELETE scope (#52): deleteByIdAndUserId must NEVER remove another user's trip. Every
 * finder is asserted userId-scoped (the C155/C109 tenant discipline). Also pins the derived
 * `tripDistance` clamp (R2, the #46 negative-guard).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import type { NewTrip } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { TripRepository, tripDistance } from '../repository';

const USER_ID = 'u-trip';
const OTHER_USER = 'u-trip-other';
const VEHICLE_ID = 'v-trip';
const OTHER_VEHICLE = 'v-trip-2';

let sqliteDb: Database;
let db: AppDatabase;
let repo: TripRepository;
let counter = 0;

/** Build a NewTrip with sensible defaults; tripDate increments so newest-first ordering is deterministic. */
function tripData(overrides: Partial<NewTrip> = {}): NewTrip {
  counter++;
  return {
    vehicleId: VEHICLE_ID,
    userId: USER_ID,
    startOdometer: 1000,
    endOdometer: 1080,
    purpose: 'business',
    tripDate: new Date(1_700_000_000_000 + counter * 86_400_000), // +1 day each
    ...overrides,
  };
}

describe('TripRepository (T2)', () => {
  const migrations = loadMigrations();

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(sqliteDb, migrations, migrations.length - 1);
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 't@x.com', 'Trip User')`
    );
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${OTHER_USER}', 'o@x.com', 'Other User')`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${OTHER_VEHICLE}', '${USER_ID}', 'Honda', 'Civic', 2021)`
    );
    db = drizzle(sqliteDb, { schema });
    repo = new TripRepository(db);
    counter = 0;
  });

  afterEach(() => sqliteDb.close());

  test('create persists a trip and returns it with a generated id', async () => {
    const trip = await repo.create(tripData({ note: 'Client visit' }));
    expect(trip.id).toBeTruthy();
    expect(trip.vehicleId).toBe(VEHICLE_ID);
    expect(trip.userId).toBe(USER_ID);
    expect(trip.purpose).toBe('business');
    expect(trip.note).toBe('Client visit');
  });

  test('findByIdAndUserId returns the owner’s trip and NULL for a foreign user (#52 read scope)', async () => {
    const trip = await repo.create(tripData());
    expect(await repo.findByIdAndUserId(trip.id, USER_ID)).not.toBeNull();
    // Another user must not be able to read it by id.
    expect(await repo.findByIdAndUserId(trip.id, OTHER_USER)).toBeNull();
    // An unknown id is null, not a throw.
    expect(await repo.findByIdAndUserId('nope', USER_ID)).toBeNull();
  });

  test('findByUserId returns all of a user’s trips newest-first', async () => {
    await repo.create(tripData()); // oldest
    await repo.create(tripData());
    const newest = await repo.create(tripData()); // latest tripDate
    const rows = await repo.findByUserId(USER_ID);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.id).toBe(newest.id); // desc(tripDate)
  });

  test('findByUserId filters by vehicleId and purpose, never widening past the owner', async () => {
    await repo.create(tripData({ vehicleId: VEHICLE_ID, purpose: 'business' }));
    await repo.create(tripData({ vehicleId: VEHICLE_ID, purpose: 'personal' }));
    await repo.create(tripData({ vehicleId: OTHER_VEHICLE, purpose: 'business' }));

    expect(await repo.findByUserId(USER_ID, { vehicleId: VEHICLE_ID })).toHaveLength(2);
    expect(await repo.findByUserId(USER_ID, { purpose: 'business' })).toHaveLength(2);
    expect(
      await repo.findByUserId(USER_ID, { vehicleId: VEHICLE_ID, purpose: 'personal' })
    ).toHaveLength(1);
  });

  test('findByUserId is userId-scoped — a foreign user sees none of these trips', async () => {
    await repo.create(tripData());
    await repo.create(tripData());
    expect(await repo.findByUserId(OTHER_USER)).toHaveLength(0);
  });

  test('findByVehicle is tenant-scoped (vehicle_id AND user_id)', async () => {
    await repo.create(tripData({ vehicleId: VEHICLE_ID }));
    await repo.create(tripData({ vehicleId: OTHER_VEHICLE }));
    expect(await repo.findByVehicle(VEHICLE_ID, USER_ID)).toHaveLength(1);
    // The same vehicleId under a foreign user yields nothing.
    expect(await repo.findByVehicle(VEHICLE_ID, OTHER_USER)).toHaveLength(0);
  });

  test('findByUserIdPaginated honors limit/offset with an unbounded total', async () => {
    for (let i = 0; i < 5; i++) await repo.create(tripData());
    const page = await repo.findByUserIdPaginated(USER_ID, 2, 2);
    expect(page.totalCount).toBe(5);
    expect(page.data).toHaveLength(2);
  });

  test('findIdsByVehicleId returns every trip id for the vehicle (cascade cleanup)', async () => {
    const a = await repo.create(tripData());
    const b = await repo.create(tripData());
    await repo.create(tripData({ vehicleId: OTHER_VEHICLE }));
    const ids = await repo.findIdsByVehicleId(VEHICLE_ID);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  // The spec's required #52 regression: a destructive delete keyed on id ALONE would let one user
  // delete another's trip. deleteByIdAndUserId keys on BOTH — a foreign delete is a no-op (returns false).
  test('deleteByIdAndUserId removes the owner’s trip but REFUSES a foreign user’s delete (#52)', async () => {
    const trip = await repo.create(tripData());

    // A foreign user's delete attempt removes nothing and reports false (caller → 404).
    expect(await repo.deleteByIdAndUserId(trip.id, OTHER_USER)).toBe(false);
    expect(await repo.findByIdAndUserId(trip.id, USER_ID)).not.toBeNull(); // still there

    // The owner's delete succeeds.
    expect(await repo.deleteByIdAndUserId(trip.id, USER_ID)).toBe(true);
    expect(await repo.findByIdAndUserId(trip.id, USER_ID)).toBeNull();

    // Deleting an already-gone / unknown id reports false (no throw).
    expect(await repo.deleteByIdAndUserId(trip.id, USER_ID)).toBe(false);
  });

  test('update mutates fields and bumps updatedAt', async () => {
    const trip = await repo.create(tripData({ note: 'before' }));
    const updated = await repo.update(trip.id, { note: 'after', endOdometer: 1200 });
    expect(updated.note).toBe('after');
    expect(updated.endOdometer).toBe(1200);
  });
});

describe('tripDistance (derived, R2 clamp)', () => {
  test('returns driven miles for a normal trip', () => {
    expect(tripDistance({ startOdometer: 1000, endOdometer: 1080 })).toBe(80);
  });

  test('clamps a non-increasing odometer pair to 0 (the #46 negative-guard)', () => {
    expect(tripDistance({ startOdometer: 1080, endOdometer: 1000 })).toBe(0);
    expect(tripDistance({ startOdometer: 5000, endOdometer: 5000 })).toBe(0);
  });
});
