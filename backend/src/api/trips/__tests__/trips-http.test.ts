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

  // The R5 future-guard compares the LOCAL CALENDAR DAY, not the absolute instant. The FE sends a date-only
  // value anchored at NOON LOCAL (dateOnlyToISO); a bare `d <= new Date()` instant guard 400'd a trip dated
  // TODAY whenever the server clock was before local noon (noon-local-today is then hours "in the future"),
  // breaking the form's own default for the entire local morning. These two pin the fix (the #87/#106 family).
  test('ACCEPTS a trip dated TODAY sent as noon-local (the FE dateOnlyToISO contract — not a future reject)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const now = new Date();
    // Exactly what FE dateOnlyToISO(today) produces: today's local Y/M/D anchored at 12:00 LOCAL.
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

  test('still rejects TOMORROW (a genuine future local day, 400) — the guard is not neutered', async () => {
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

  // C228 deep-review cert (NORTH_STAR #1, backup-safety): a create that OMITS the optional locations/note
  // must persist them as SQL NULL — not '' and not the string 'undefined'. The C227 TripForm sends
  // `value.trim() || undefined`, JSON drops undefined keys, Zod .optional() leaves them absent, and the
  // route coalesces `data.x ?? null`. This pins that whole FE→BE→DB chain end-to-end (the omitted path was
  // implicit in every other test via the VALID() helper but never ASSERTED to land as null), so a future
  // refactor that dropped the `?? null` or made the schema default to '' would flip a RED assertion. Reads
  // the row straight from SQLite (the stored value, not the API echo) to catch a coercion the JSON wouldn't.
  test('a create omitting optional locations/note persists them as NULL (FE undefined→absent→null, #1)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/trips', {
      vehicleId,
      startOdometer: 1000,
      endOdometer: 1100,
      purpose: 'personal',
      tripDate: '2024-06-20T12:00:00.000Z',
      // startLocation / endLocation / note deliberately omitted (the blank-field wire shape)
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

  test('a create WITH locations/note round-trips the values through the stack (the populated path)', async () => {
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

  // D2 (ratified): creating a trip ALSO writes an odometer entry at endOdometer/tripDate, so the trip's
  // end reading feeds the all-time currentOdometer + the mileage-reminder axis (reuse, not a parallel log).
  test('creating a trip feeds currentOdometer via a deduped odometer entry (D2)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 4800, endOdometer: 5000 })
    );
    expect(res.status).toBe(201);

    // An odometer entry now exists at the trip's end reading...
    const odoRows = ctx.sqlite
      .query('SELECT odometer FROM odometer_entries WHERE vehicle_id = ?')
      .all(vehicleId) as { odometer: number }[];
    expect(odoRows.map((r) => r.odometer)).toContain(5000);

    // ...and getCurrentOdometer reflects it (drives maintenance mileage reminders + lease overage).
    const { odometerRepository } = await import('../../odometer/repository');
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(5000);
  });

  test('a second trip the SAME day at the SAME end reading does NOT double-log the odometer (D2 dedup)', async () => {
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
    expect(n).toBe(1); // same (vehicle, day, reading) → one odometer entry, not two
  });

  // C233 deep-review: the route comments "Both [D2 side-effects] are best-effort — the trip is already
  // persisted, so a … hiccup never fails the create." recheckMileageReminders is internally guarded (C42)
  // but createFromTrip is a plain repo write that CAN throw a DatabaseError; left unguarded it 500'd a create
  // whose trip row ALREADY committed → the FE showed "failed" + a retry made a DUPLICATE. Fault-inject a
  // createFromTrip throw and pin the contract: the create still returns 201 AND the trip is persisted (the
  // best-effort linkage swallows + logs, never propagates). Non-vacuous: drop the route try/catch → 500 here.
  test('a createFromTrip (D2 linkage) throw does NOT fail the create — trip persists, 201 returned (C233)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const { odometerRepository } = await import('../../odometer/repository');
    const original = odometerRepository.createFromTrip;
    // Simulate a DB hiccup in the D2 side-effect AFTER the trip row commits.
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
      // The trip is persisted regardless of the side-effect failure (no orphaned 500).
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

// C216 (guard): the SECOND half of D2's promise — "a trip's end reading drives the mileage-reminder axis".
// C213 wired recheckMileageReminders into the trip POST + pinned that getCurrentOdometer reflects the
// reading, but never asserted a mileage reminder actually FIRES when a trip crosses its milestone. A C216
// bug-scout verified the full chain end-to-end firsthand (POST trip → createFromTrip → getCurrentOdometer →
// recheck → notification); this pins it so a regression in the trip→odometer→recheck wiring goes red — and
// a control that a BELOW-milestone trip fires nothing (no false notification).
describe('a trip crossing a mileage-reminder milestone fires the notification (D2 end-to-end, C216)', () => {
  /** Seed a mileage-axis reminder due at `dueOdometer` for one vehicle (raw — the mileage API is partial). */
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
    // The trip's 10500 reading fed getCurrentOdometer → recheck fired the 10000 milestone.
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
    expect(notifCount('rm-far')).toBe(0); // 9500 < 10000 → not yet due
  });
});

// C214 (guard — CHARACTERIZATION of the CURRENT trips↔odometer lifecycle, escalated to Angelo). The D2
// linkage (C213) writes an odometer entry on trip CREATE, but that entry has NO lifecycle tie back to its
// trip: editing the trip's endOdometer or deleting the trip leaves the original odometer reading in place,
// so getCurrentOdometer keeps the stale value (the #76/#244 stray-reading-poisons-currentOdometer class on
// the maintenance-reminder + lease-overage axes). Whether that's correct (independent-observation model) or
// a bug (owned-child model needing a source-link schema slice) is a SEMANTICS decision filed with Angelo
// (send_message C214). These tests PIN today's behavior so it's explicit + can't silently drift; when the
// decision lands, the chosen fix flips the relevant assertion RED (the #148/C102 escalation-anchor pattern).
const odoCount = (ctx: TestApp, vehicleId: string): number =>
  (
    ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ?')
      .get(vehicleId) as {
      n: number;
    }
  ).n;

describe('trips↔odometer lifecycle on EDIT/DELETE (C214 characterization — pending Angelo)', () => {
  test('editing a trip’s endOdometer does NOT update the linked odometer entry (independent-observation, today)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 5000 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(odoCount(ctx, vehicleId)).toBe(1);

    // Correct the reading downward (fat-finger 5000 → 500).
    const put = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      startOdometer: 100,
      endOdometer: 500,
    });
    expect(put.status).toBe(200);

    const { odometerRepository } = await import('../../odometer/repository');
    // TODAY: the original 5000 odometer entry lingers; getCurrentOdometer still reads 5000. (If Angelo
    // chooses the owned-child model, this becomes 500 + this assertion flips.)
    expect(odoCount(ctx, vehicleId)).toBe(1);
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(5000);
  });

  test('deleting a trip does NOT remove the linked odometer entry (independent-observation, today)', async () => {
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
    // TODAY: the odometer entry survives the trip delete (a point-in-time observation). (Owned-child model
    // would cascade it away → 0 + null.)
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

describe('GET /api/v1/trips/summary (T5 mileage rollup)', () => {
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
    expect(body.data.businessMileageValue).toBeCloseTo(50, 5); // 100 × 0.5
    expect(body.data.milesByPurpose.personal).toBe(30);
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
