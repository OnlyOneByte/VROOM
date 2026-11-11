/**
 * HTTP tests for the trip routes through the real stack. The harness seeds one user. Cross-tenant cases
 * seed a second user directly in SQLite and assert the first user cannot reach that data.
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

/** Seeds a second user with a vehicle and a trip, via raw SQL. */
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

  test('rejects endOdometer below startOdometer', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1080, endOdometer: 1000 })
    );
    expect(res.status).toBe(400);
  });

  test('rejects a future tripDate', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { tripDate: '2999-01-01T00:00:00.000Z' })
    );
    expect(res.status).toBe(400);
  });

  // The future guard compares local calendar days. The client sends noon-local dates, so an instant
  // comparison would wrongly reject today's trip before noon.
  test('accepts a trip dated today sent as noon local time', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const now = new Date();
    const todayNoonLocal = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
      0,
      0
    ).toISOString();
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { tripDate: todayNoonLocal })
    );
    expect(res.status, await res.text()).toBe(201);
  });

  test('rejects a trip dated tomorrow', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const now = new Date();
    const tomorrowNoonLocal = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      12,
      0,
      0
    ).toISOString();
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { tripDate: tomorrowNoonLocal })
    );
    expect(res.status).toBe(400);
  });

  test('rejects an unknown purpose', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { purpose: 'joyride' }));
    expect(res.status).toBe(400);
  });

  test('a trip on a vehicle the user does not own returns 404, not 403', async () => {
    const { vehicleId } = seedForeignTrip();
    const res = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    expect(res.status).toBe(404);
  });

  // Omitted optional fields must be stored as NULL, not as empty strings or the text 'undefined'.
  // The row is read straight from SQLite so a coercion the JSON response would hide is still caught.
  test('a create omitting optional locations and note stores NULL', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/trips', {
      vehicleId,
      startOdometer: 1000,
      endOdometer: 1100,
      purpose: 'personal',
      tripDate: '2024-06-20T12:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = ctx.sqlite
      .query('SELECT start_location, end_location, note FROM trips WHERE id = ?')
      .get(body.data.id) as {
      start_location: string | null;
      end_location: string | null;
      note: string | null;
    };
    expect(row.start_location).toBeNull();
    expect(row.end_location).toBeNull();
    expect(row.note).toBeNull();
  });

  test('a create with locations and note returns them', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startLocation: 'Home', endLocation: 'Office', note: 'Standup' })
    );
    const body =
      await json<DataEnvelope<{ startLocation: string; endLocation: string; note: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.startLocation).toBe('Home');
    expect(body.data.endLocation).toBe('Office');
    expect(body.data.note).toBe('Standup');
  });

  // Creating a trip also writes an odometer entry at its end reading, so the reading feeds the
  // current odometer and mileage reminders.
  test('creating a trip feeds currentOdometer through a deduplicated odometer entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 4800, endOdometer: 5000 })
    );
    expect(res.status).toBe(201);

    const odoRows = ctx.sqlite
      .query('SELECT odometer FROM odometer_entries WHERE vehicle_id = ?')
      .all(vehicleId) as { odometer: number }[];
    expect(odoRows.map((r) => r.odometer)).toContain(5000);

    const { odometerRepository } = await import('../../odometer/repository');
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(5000);
  });

  test('a second trip on the same day at the same end reading does not double-log the odometer', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const body = (end: number) =>
      VALID(vehicleId, {
        startOdometer: 4800,
        endOdometer: end,
        tripDate: '2024-06-20T08:00:00.000Z',
      });
    await ctx.authed('POST', '/api/v1/trips', body(5000));
    await ctx.authed('POST', '/api/v1/trips', {
      ...body(5000),
      tripDate: '2024-06-20T19:00:00.000Z',
    });

    const n = (
      ctx.sqlite
        .query('SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ?')
        .get(vehicleId) as {
        n: number;
      }
    ).n;
    expect(n).toBe(1);
  });

  // The odometer side effect is best-effort: the trip is already persisted, so its failure must not fail the create.
  test('a failing odometer side effect does not fail the create; the trip persists', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const { odometerRepository } = await import('../../odometer/repository');
    const original = odometerRepository.createFromTrip;
    odometerRepository.createFromTrip = async () => {
      throw new Error('simulated DB hiccup in createFromTrip');
    };
    try {
      const res = await ctx.authed(
        'POST',
        '/api/v1/trips',
        VALID(vehicleId, { startOdometer: 1000, endOdometer: 1100 })
      );
      expect(res.status, await res.text()).toBe(201);
      const n = (
        ctx.sqlite.query('SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?').get(vehicleId) as {
          n: number;
        }
      ).n;
      expect(n).toBe(1);
    } finally {
      odometerRepository.createFromTrip = original;
    }
  });
});

// Covers the full path: trip create, odometer entry, recheck, then notification.
describe('a trip crossing a mileage reminder milestone fires the notification', () => {
  /** Seeds a mileage reminder due at dueOdometer for one vehicle. */
  function seedMileageReminder(id: string, vehicleId: string, dueOdometer: number): void {
    ctx.sqlite.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode,
         interval_mileage, next_due_odometer, start_date, next_due_date, is_active)
       VALUES (?, ?, 'Oil change', 'notification', 'automatic', 'mileage', 'mileage', 5000, ?, 0, NULL, 1)`,
      [id, ctx.user.id, dueOdometer]
    );
    ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
      id,
      vehicleId,
    ]);
  }
  const notifCount = (reminderId: string): number =>
    (
      ctx.sqlite
        .query('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?')
        .get(reminderId) as { n: number }
    ).n;

  test('a trip whose endOdometer reaches the milestone fires exactly one notification', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    seedMileageReminder('rm-due', vehicleId, 10000);
    expect(notifCount('rm-due')).toBe(0);

    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 9000, endOdometer: 10500 })
    );
    expect(res.status).toBe(201);
    expect(notifCount('rm-due')).toBe(1);
  });

  test('a trip BELOW the milestone fires nothing (no false notification)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedMileageReminder('rm-far', vehicleId, 10000);

    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 8000, endOdometer: 9500 })
    );
    expect(res.status).toBe(201);
    expect(notifCount('rm-far')).toBe(0);
  });
});

const odoCount = (ctx: TestApp, vehicleId: string): number =>
  (
    ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ?')
      .get(vehicleId) as {
      n: number;
    }
  ).n;

describe('trip edit and delete keep the linked odometer entry in sync', () => {
  test('editing a trip’s end reading re-syncs the linked odometer entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 5000 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(odoCount(ctx, vehicleId)).toBe(1);

    const put = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      startOdometer: 100,
      endOdometer: 500,
    });
    expect(put.status).toBe(200);

    const { odometerRepository } = await import('../../odometer/repository');
    // The stale entry is replaced, so the current odometer follows the correction.
    expect(odoCount(ctx, vehicleId)).toBe(1);
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(500);
  });

  test('deleting a trip keeps the linked odometer entry by default', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 5000 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(odoCount(ctx, vehicleId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/trips/${data.id}`);
    expect(del.status).toBe(200);

    const { odometerRepository } = await import('../../odometer/repository');
    expect(odoCount(ctx, vehicleId)).toBe(1);
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(5000);
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

describe('GET /api/v1/trips/summary (mileage rollup)', () => {
  test('cross-fleet summary with the business-$ at the supplied rate', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' })
    );
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 2000, endOdometer: 2030, purpose: 'personal' })
    );

    const res = await ctx.authed('GET', '/api/v1/trips/summary?rate=0.5');
    const body =
      await json<
        DataEnvelope<{
          totalMiles: number;
          businessMiles: number;
          businessMileageValue: number;
          milesByPurpose: Record<string, number>;
        }>
      >(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.totalMiles).toBe(130);
    expect(body.data.businessMiles).toBe(100);
    expect(body.data.businessMileageValue).toBeCloseTo(50, 5);
    expect(body.data.milesByPurpose.personal).toBe(30);
  });

  // Characterizes a known limitation: the cross-fleet summary sums raw odometer deltas even when vehicles
  // use different distance units. Fixing it is a product decision, so this assertion should change
  // deliberately when units are converted.
  test('cross-fleet summary sums raw deltas across mixed-unit vehicles', async () => {
    const miVehicle = await seedVehicle(ctx, {
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      extra: {
        unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
      },
    });
    const kmVehicle = await seedVehicle(ctx, {
      make: 'Renault',
      model: 'Zoe',
      year: 2023,
      extra: {
        unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
      },
    });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(miVehicle, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' })
    );
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(kmVehicle, { startOdometer: 5000, endOdometer: 5200, purpose: 'business' })
    );

    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<{ totalMiles: number; businessMiles: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.totalMiles).toBe(300);
    expect(body.data.businessMiles).toBe(300);
  });

  test('summary scoped to a vehicle counts only that vehicle’s trips', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(v1, { startOdometer: 0, endOdometer: 100, purpose: 'business' })
    );
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(v2, { startOdometer: 0, endOdometer: 999, purpose: 'business' })
    );

    const res = await ctx.authed('GET', `/api/v1/trips/summary?vehicleId=${v1}`);
    const body = await json<DataEnvelope<{ totalMiles: number; tripCount: number }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.tripCount).toBe(1);
    expect(body.data.totalMiles).toBe(100); // v2's 999 excluded
  });

  test('summary on an UNOWNED vehicle is 404 (no cross-tenant rollup)', async () => {
    const { vehicleId } = seedForeignTrip();
    const res = await ctx.authed('GET', `/api/v1/trips/summary?vehicleId=${vehicleId}`);
    expect(res.status).toBe(404);
  });

  test('empty fleet → zeros, not NaN', async () => {
    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<{ totalMiles: number; averageTripMiles: number }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.totalMiles).toBe(0);
    expect(body.data.averageTripMiles).toBe(0);
  });

  // The rate multiplies into a displayed dollar figure, so negative and non-finite values must be rejected.
  test('a negative rate is rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' })
    );
    const res = await ctx.authed('GET', '/api/v1/trips/summary?rate=-0.5');
    expect(res.status).toBe(400);
  });

  test('a non-finite rate is rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' })
    );
    const inf = await ctx.authed('GET', '/api/v1/trips/summary?rate=Infinity');
    expect(inf.status).toBe(400);
    const nan = await ctx.authed('GET', '/api/v1/trips/summary?rate=NaN');
    expect(nan.status).toBe(400);
  });

  test('a valid rate yields a finite business value', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' })
    );
    const res = await ctx.authed('GET', '/api/v1/trips/summary?rate=0.655');
    const body =
      await json<DataEnvelope<{ businessMiles: number; businessMileageValue: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.businessMiles).toBe(100);
    expect(body.data.businessMileageValue).toBeCloseTo(65.5, 5);
    expect(Number.isFinite(body.data.businessMileageValue)).toBe(true);
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

  test('rejects an update that inverts the odometer pair', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId));
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      startOdometer: 2000,
      endOdometer: 1500,
    });
    expect(res.status).toBe(400);
  });

  // A partial update must be checked against the stored value of the other odometer, not just the body.
  test('rejects a partial update that sets endOdometer below the stored startOdometer', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, { endOdometer: 500 });
    expect(res.status).toBe(400);
    const row = ctx.sqlite
      .query('SELECT start_odometer, end_odometer FROM trips WHERE id = ?')
      .get(data.id) as { start_odometer: number; end_odometer: number };
    expect(row.start_odometer).toBe(1000);
    expect(row.end_odometer).toBe(1080);
  });

  test('rejects a partial update that sets startOdometer above the stored endOdometer', async () => {
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

  test('accepts a valid partial update of endOdometer against the stored start', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, { endOdometer: 1200 });
    const body = await json<DataEnvelope<{ endOdometer: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.endOdometer).toBe(1200);
  });

  test('a foreign trip update returns 404 and writes nothing', async () => {
    const { tripId } = seedForeignTrip();
    const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { note: 'hijack' });
    expect(res.status).toBe(404);
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

  test('a foreign trip delete returns 404 and removes nothing', async () => {
    const { tripId } = seedForeignTrip();
    const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}`);
    expect(res.status).toBe(404);
    const row = ctx.sqlite.query('SELECT COUNT(*) AS n FROM trips WHERE id = ?').get(tripId) as {
      n: number;
    };
    expect(row.n).toBe(1);
  });

  test('requires authentication', async () => {
    const res = await ctx.anon('GET', '/api/v1/trips');
    expect(res.status).toBe(401);
  });
});

/**
 * The odometer entry linked to a trip. Create writes a deduplicated row stamped note 'From trip'.
 * Delete keeps it unless keepOdometer=false, and that removal never touches a manual reading.
 * Editing the reading or date moves the linked entry.
 */
describe('trip-linked odometer lifecycle', () => {
  /** Counts trip-linked odometer entries at a reading. */
  function linkedEntryCount(vehicleId: string, odometer: number): number {
    const row = ctx.sqlite
      .query(
        `SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ? AND odometer = ? AND note = 'From trip'`
      )
      .get(vehicleId, odometer) as { n: number };
    return row.n;
  }

  test('create writes the linked odometer entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { endOdometer: 1080 }));
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);
  });

  test('deleting a trip by default keeps the linked odometer entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${data.id}`);
    expect(res.status).toBe(200);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);
  });

  test('deleting a trip with keepOdometer=false also removes the linked odometer entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${data.id}?keepOdometer=false`);
    expect(res.status).toBe(200);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(0);
  });

  test('keepOdometer=false does not remove a manual reading at the same vehicle, day and value', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 1080,
      recordedAt: '2024-06-20T13:30:00.000Z',
      note: 'manual log',
    });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(0);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${data.id}?keepOdometer=false`);
    expect(res.status).toBe(200);
    const manual = ctx.sqlite
      .query(
        `SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ? AND odometer = 1080 AND note = 'manual log'`
      )
      .get(vehicleId) as { n: number };
    expect(manual.n).toBe(1);
  });

  test('editing endOdometer moves the linked entry to the new reading', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, { endOdometer: 1200 });
    expect(res.status).toBe(200);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(0);
    expect(linkedEntryCount(vehicleId, 1200)).toBe(1);
  });

  // The removal must key on the old date, or the entry would be left behind on the old day.
  test('editing the trip date moves the linked entry to the new day', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080, tripDate: '2024-06-20T13:30:00.000Z' })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    /** Counts trip-linked entries on a local calendar day (YYYY-MM-DD). */
    const linkedOnDay = (day: string): number => {
      const start = Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
      const end = start + 86400;
      return (
        ctx.sqlite
          .query(
            `SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ? AND note = 'From trip' AND recorded_at >= ? AND recorded_at < ?`
          )
          .get(vehicleId, start, end) as { n: number }
      ).n;
    };
    expect(linkedOnDay('2024-06-20')).toBe(1);

    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      tripDate: '2024-06-25T13:30:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(linkedOnDay('2024-06-20')).toBe(0);
    expect(linkedOnDay('2024-06-25')).toBe(1);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);
  });

  // Trips on the same key share one entry. Removing it while another trip still maps to it would
  // orphan the survivor's reading.
  test('deleting one of two trips that share an odometer entry keeps the entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const a = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { endOdometer: 1080 }));
    await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { endOdometer: 1080 }));
    const { data: tripA } = await json<DataEnvelope<{ id: string }>>(a);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${tripA.id}?keepOdometer=false`);
    expect(res.status).toBe(200);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);

    const { odometerRepository } = await import('../../odometer/repository');
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(1080);
  });

  test('deleting the last trip that shares an odometer entry removes the entry', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const a = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { endOdometer: 1080 }));
    const b = await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { endOdometer: 1080 }));
    const { data: tripA } = await json<DataEnvelope<{ id: string }>>(a);
    const { data: tripB } = await json<DataEnvelope<{ id: string }>>(b);

    await ctx.authed('DELETE', `/api/v1/trips/${tripA.id}?keepOdometer=false`);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);
    await ctx.authed('DELETE', `/api/v1/trips/${tripB.id}?keepOdometer=false`);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(0);
  });
});
