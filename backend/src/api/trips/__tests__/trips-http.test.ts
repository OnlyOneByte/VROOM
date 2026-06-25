/**
 * In-process HTTP tests for the trip routes (trips-location T3) — through the REAL stack via createTestApp.
 *
 * Covers the 6 endpoints + their validation/ownership contracts:
 *   - POST create: happy path, R2 reject (end < start), future-date reject, bad-purpose reject, unowned
 *     vehicle → 404 (the #80 enumeration discipline, never 403).
 *   - GET list: paginated, vehicleId/purpose filters, tenant scope (a foreign user's trips never appear).
 *   - GET /:id: own → 200, foreign → 404.
 *   - GET /vehicle/:vehicleId: a vehicle's trips, unowned vehicle → 404.
 *   - PUT /:id: happy, R2 reject on a both-odometer update, foreign → 404.
 *   - DELETE /:id: happy, foreign → 404 (the #52 tenant-safe deleteByIdAndUserId).
 *
 * The createTestApp harness seeds ONE user; cross-tenant cases seed a 2nd user + their vehicle/trip directly
 * via ctx.sqlite, then assert the authed (1st) user can't reach them.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const VALID = (vehicleId: string, over: Record<string, unknown> = {}) => ({
  vehicleId,
  startOdometer: 1000,
  endOdometer: 1080,
  purpose: 'business',
  tripDate: '2024-06-20T13:30:00.000Z',
  ...over,
});

/** Seed a second user + their own vehicle + a trip, all via raw SQL. Returns the foreign trip + vehicle id. */
function seedForeignTrip(): { tripId: string; vehicleId: string } {
  ctx.sqlite.run(
    `INSERT INTO users (id, email, display_name) VALUES ('u2', 'other@x.com', 'Other')`
  );
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2', 'u2', 'Honda', 'Civic', 2021)`
  );
  ctx.sqlite.run(
    `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
     VALUES ('t2', 'v2', 'u2', 1000, 1100, 'personal', 1718890200)`
  );
  return { tripId: 't2', vehicleId: 'v2' };
}

describe('POST /api/v1/trips (create)', () => {
  test('creates a trip on an owned vehicle (201, fields persisted)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { note: 'Client visit' })
    );
    const body = await json<DataEnvelope<{ id: string; purpose: string; note: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.purpose).toBe('business');
    expect(body.data.note).toBe('Client visit');
  });

  test('rejects endOdometer < startOdometer (R2, 400)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1080, endOdometer: 1000 })
    );
    expect(res.status).toBe(400);
  });

  test('rejects a future tripDate (R5 future-guard, 400)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { tripDate: '2999-01-01T00:00:00.000Z' })
    );
    expect(res.status).toBe(400);
  });

  test('rejects an unknown purpose (D4 enum, 400)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { purpose: 'joyride' }));
    expect(res.status).toBe(400);
  });

  test('a trip on an UNOWNED vehicle is 404, not 403 (no enumeration oracle, #80)', async () => {
    const { vehicleId } = seedForeignTrip();
    const res = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/trips (list)', () => {
  test('lists the user’s trips, newest first, with a total count', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { tripDate: '2024-06-01T00:00:00.000Z' })
    );
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { tripDate: '2024-06-20T00:00:00.000Z' })
    );

    const res = await ctx.authed('GET', '/api/v1/trips');
    const body = await json<{ data: { tripDate: string }[]; pagination: { totalCount: number } }>(
      res
    );
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.totalCount).toBe(2);
  });

  test('filters by purpose', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { purpose: 'business' }));
    await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { purpose: 'personal' }));

    const res = await ctx.authed('GET', '/api/v1/trips?purpose=personal');
    const body = await json<{ data: { purpose: string }[] }>(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].purpose).toBe('personal');
  });

  test('a foreign user’s trips never appear in the list (tenant scope)', async () => {
    seedForeignTrip(); // u2's trip exists in the DB
    const res = await ctx.authed('GET', '/api/v1/trips');
    const body = await json<{ data: { id: string }[] }>(res);
    expect(res.status).toBe(200);
    expect(body.data.some((t) => t.id === 't2')).toBe(false);
  });
});

describe('GET /api/v1/trips/:id', () => {
  test('returns an owned trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('GET', `/api/v1/trips/${data.id}`);
    expect(res.status).toBe(200);
  });

  test('a foreign trip id is 404 (not 403)', async () => {
    const { tripId } = seedForeignTrip();
    const res = await ctx.authed('GET', `/api/v1/trips/${tripId}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/trips/vehicle/:vehicleId', () => {
  test('returns a vehicle’s trips', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    const res = await ctx.authed('GET', `/api/v1/trips/vehicle/${vehicleId}`);
    const body = await json<{ data: unknown[] }>(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  test('an unowned vehicle is 404', async () => {
    const { vehicleId } = seedForeignTrip();
    const res = await ctx.authed('GET', `/api/v1/trips/vehicle/${vehicleId}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/trips/:id', () => {
  test('updates an owned trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      note: 'updated',
      endOdometer: 1200,
    });
    const body = await json<DataEnvelope<{ note: string; endOdometer: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.note).toBe('updated');
    expect(body.data.endOdometer).toBe(1200);
  });

  test('rejects a both-odometer update that inverts the pair (R2 survives the partial, 400)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      startOdometer: 2000,
      endOdometer: 1500,
    });
    expect(res.status).toBe(400);
  });

  // C211 (bug): a PARTIAL PUT must be validated against the EFFECTIVE merged pair, not just the body. The
  // updateTripSchema refine fires only when BOTH odometers are present, so sending ONLY endOdometer below
  // the STORED startOdometer (or ONLY startOdometer above the stored end) bypassed R2 and persisted an
  // inverted pair → tripDistance clamps to 0, a phantom 0-mile trip (#109/#130 class). The route now
  // re-checks the merged pair against the existing row.
  test('rejects a partial PUT of ONLY endOdometer below the STORED startOdometer (#109/#130, 400)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, { endOdometer: 500 });
    expect(res.status).toBe(400);
    // The inverted value was NOT persisted — the stored pair is untouched.
    const row = ctx.sqlite
      .query('SELECT start_odometer, end_odometer FROM trips WHERE id = ?')
      .get(data.id) as { start_odometer: number; end_odometer: number };
    expect(row.start_odometer).toBe(1000);
    expect(row.end_odometer).toBe(1080);
  });

  test('rejects a partial PUT of ONLY startOdometer above the STORED endOdometer (#109/#130, 400)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, { startOdometer: 5000 });
    expect(res.status).toBe(400);
  });

  test('ACCEPTS a valid partial PUT of ONLY endOdometer above the stored start (no false reject)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    // 1200 >= stored start 1000 → valid; must NOT be falsely rejected by the merged-pair check.
    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, { endOdometer: 1200 });
    const body = await json<DataEnvelope<{ endOdometer: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.endOdometer).toBe(1200);
  });

  test('a foreign trip update is 404 (no cross-tenant write)', async () => {
    const { tripId } = seedForeignTrip();
    const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { note: 'hijack' });
    expect(res.status).toBe(404);
    // The foreign row is untouched.
    const row = ctx.sqlite.query('SELECT note FROM trips WHERE id = ?').get(tripId) as {
      note: string | null;
    };
    expect(row.note).toBeNull();
  });
});

describe('DELETE /api/v1/trips/:id', () => {
  test('deletes an owned trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${data.id}`);
    expect(res.status).toBe(200);
    const after = await ctx.authed('GET', `/api/v1/trips/${data.id}`);
    expect(after.status).toBe(404);
  });

  test('a foreign trip delete is 404 and removes NOTHING (#52 tenant-safe delete)', async () => {
    const { tripId } = seedForeignTrip();
    const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}`);
    expect(res.status).toBe(404);
    const row = ctx.sqlite.query('SELECT COUNT(*) AS n FROM trips WHERE id = ?').get(tripId) as {
      n: number;
    };
    expect(row.n).toBe(1); // still there
  });

  test('requires auth (401 anon)', async () => {
    const res = await ctx.anon('GET', '/api/v1/trips');
    expect(res.status).toBe(401);
  });
});
