// Trips must survive a real export and restore with their data intact. Rows are seeded directly
// into SQLite, so the test does not depend on the create route.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface TripRowDb {
  id: string;
  vehicle_id: string;
  user_id: string;
  start_odometer: number;
  end_odometer: number;
  purpose: string;
  trip_date: number;
  start_location: string | null;
  end_location: string | null;
  note: string | null;
}

function tripRows(): TripRowDb[] {
  return ctx.sqlite.query('SELECT * FROM trips ORDER BY id').all() as TripRowDb[];
}

/** Inserts a trip row directly, stamping userId the way restore does. */
function seedTrip(
  ctx: TestApp,
  id: string,
  vehicleId: string,
  opts: Partial<Omit<TripRowDb, 'id' | 'vehicle_id' | 'user_id'>> = {}
): void {
  const {
    start_odometer = 1000,
    end_odometer = 1080,
    purpose = 'business',
    trip_date = 1718841600, // 2024-06-20 (unix seconds, timestamp mode)
    start_location = null,
    end_location = null,
    note = null,
  } = opts;
  ctx.sqlite.run(
    `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date,
       start_location, end_location, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      vehicleId,
      ctx.user.id,
      start_odometer,
      end_odometer,
      purpose,
      trip_date,
      start_location,
      end_location,
      note,
    ]
  );
}

describe('backup → restore round-trip preserves trips', () => {
  test('a fully-populated trip survives export + restore with its fields intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // A non-midnight UTC instant catches date-only truncation or timezone shifts in the round trip.
    const tripDateSec = Math.floor(Date.UTC(2024, 5, 20, 13, 30, 0) / 1000);
    seedTrip(ctx, 'trip-1', vehicleId, {
      start_odometer: 24000,
      end_odometer: 24135,
      purpose: 'business',
      trip_date: tripDateSec,
      start_location: 'Office',
      end_location: 'Client site',
      note: 'Q2 review meeting',
    });
    expect(tripRows()).toHaveLength(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.trips, 'restore summary counts the trip').toBe(1);

    const rows = tripRows();
    expect(rows, 'exactly one trip after restore (no dup, no loss)').toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe('trip-1');
    expect(row.vehicle_id).toBe(vehicleId);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.start_odometer).toBe(24000);
    expect(row.end_odometer).toBe(24135);
    expect(row.purpose).toBe('business');
    expect(row.trip_date).toBe(tripDateSec);
    expect(row.start_location).toBe('Office');
    expect(row.end_location).toBe('Client site');
    expect(row.note).toBe('Q2 review meeting');
  });

  test('a trip with NULL optional fields (no locations/note) round-trips as null, not "" ', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedTrip(ctx, 'trip-min', vehicleId, { purpose: 'personal' });

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = tripRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe('personal');
    // An empty optional cell restores as NULL, not an empty string.
    expect(rows[0].start_location).toBeNull();
    expect(rows[0].end_location).toBeNull();
    expect(rows[0].note).toBeNull();
  });

  test('multiple trips across purposes all survive the round-trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    seedTrip(ctx, 't-biz', vehicleId, { purpose: 'business' });
    seedTrip(ctx, 't-per', vehicleId, { purpose: 'personal' });
    seedTrip(ctx, 't-com', vehicleId, { purpose: 'commute' });
    expect(tripRows()).toHaveLength(3);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.trips).toBe(3);
    expect(tripRows().map((r) => r.purpose)).toEqual(['business', 'commute', 'personal']);
  });

  test('a trip referencing a vehicle absent from the backup is rejected (referential integrity)', async () => {
    // A trip whose vehicle is missing must fail validation, so the restore aborts before the wipe.
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    seedTrip(ctx, 'trip-ok', vehicleId);

    const { backupService } = await import('../backup');

    // Export a valid backup, then corrupt it: point the trip at a non-existent vehicle.
    const zip = await backupService.exportAsZip(ctx.user.id);
    const AdmZip = (await import('adm-zip')).default;
    const archive = new AdmZip(zip);
    const tripsCsv = archive.getEntry('trips.csv');
    expect(tripsCsv, 'the backup contains trips.csv').toBeTruthy();
    const csv = tripsCsv?.getData().toString('utf8') ?? '';
    const corrupted = csv.replace(vehicleId, 'ghost-vehicle-id');
    archive.updateFile('trips.csv', Buffer.from(corrupted, 'utf8'));
    const corruptedZip = archive.toBuffer();

    const { restoreService } = await import('../restore');
    await expect(
      restoreService.restoreFromBackup(ctx.user.id, corruptedZip, 'replace')
    ).rejects.toThrow();
  });
});
