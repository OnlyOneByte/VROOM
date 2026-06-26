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

// C214 (T7 — the RATIFIED trips↔odometer lifecycle, was the pending characterization). Angelo ruled
// (2026-06-25): editing a trip's endOdometer/tripDate RE-SYNCS the linked odometer entry; deleting a trip
// PROMPTS keep-or-delete (non-destructive default = KEEP). These tests previously pinned the pre-ruling
// "independent-observation" behavior as an escalation anchor; they now assert the ratified semantics (the
// #148/C102 anchor-flips-on-ruling pattern, discharged). The keepOdometer=false path + the manual-reading
// safety + the re-sync no-orphan invariant are pinned in the "C214 trips↔odometer lifecycle (T7)" block above.
const odoCount = (ctx: TestApp, vehicleId: string): number =>
  (
    ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ?')
      .get(vehicleId) as {
      n: number;
    }
  ).n;

describe('trips↔odometer lifecycle on EDIT/DELETE (C214 ratified, T7)', () => {
  test('editing a trip’s endOdometer RE-SYNCS the linked odometer entry (currentOdometer tracks the correction)', async () => {
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
    // RATIFIED (C214 case 3): the stale 5000 entry is removed + a fresh linked entry written at 500, so
    // getCurrentOdometer reflects the correction (no #76/#244 stray-reading poison on the reminder axis).
    expect(odoCount(ctx, vehicleId)).toBe(1);
    expect(await odometerRepository.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(500);
  });

  test('deleting a trip (default) KEEPS the linked odometer entry (non-destructive default, C214 case 1)', async () => {
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
    // RATIFIED default = KEEP: the odometer entry survives the trip delete (the user keeps odometer history).
    // The keepOdometer=false opt-in removal is pinned in the T7 block above.
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

  // C236 escalation-anchor (the #148/C102 pattern) for the #94 unit-pooling class on the trips cross-fleet
  // rollup. The cross-fleet summary sums tripDistance across ALL vehicles, but trip odometers are stored in
  // EACH vehicle's own distanceUnit (R2) — so a mixed mi+km fleet pools mi + km into ONE unlabeled scalar
  // (the #94 class the C223 deep-review already filed + escalated as product-gated). This PINS today's
  // raw-pool behavior (a km vehicle's 200-unit trip + a mi vehicle's 100-unit trip → totalMiles 300, NOT
  // unit-converted) so the eventual #94 fix (convert-to-user-global / per-vehicle-only / require-vehicleId)
  // FLIPS a RED assertion rather than silently changing a displayed figure unnoticed. NOT a fix — the call
  // is Angelo's (escalated); this is the characterization net that makes the change visible when it lands.
  test('cross-fleet summary POOLS raw odometer deltas across mixed-unit vehicles (#94 anchor — characterization, not endorsement)', async () => {
    // Full unitPreferences shape (the create schema requires all three) — only distanceUnit differs.
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
      VALID(miVehicle, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' }) // 100 mi
    );
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(kmVehicle, { startOdometer: 5000, endOdometer: 5200, purpose: 'business' }) // 200 km
    );

    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<{ totalMiles: number; businessMiles: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    // TODAY: 100 (mi) + 200 (km) summed RAW = 300, with no per-vehicle conversion (the #94 imperfection).
    // When #94 is ruled + fixed, this number changes → this assertion goes RED → update it deliberately.
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

  // C253 money-rate boundary guard (NORTH_STAR #1/#2 — businessMileageValue = businessMiles × rate is a
  // DISPLAYED $ figure). A C253 bug-scout certified the summary money path clean firsthand: the
  // `summaryQuerySchema.rate = z.coerce.number().min(0).optional()` (routes.ts:46) REJECTS a negative rate
  // (would flip the reimbursement $ negative) and a non-finite rate ('Infinity'/'NaN' → businessMiles × ∞ =
  // Infinity/NaN money), so no defect — but NO HTTP test pinned that boundary. These are the merge-surviving
  // net: loosening the schema (dropping .min(0), or swapping the coercing parse for a plain z.number() that
  // accepts Infinity) would let a garbage/negative money rate through → these go RED with the exact diagnostic.
  test('a NEGATIVE rate is rejected (no negative reimbursement $) — 400', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { startOdometer: 1000, endOdometer: 1100, purpose: 'business' })
    );
    const res = await ctx.authed('GET', '/api/v1/trips/summary?rate=-0.5');
    expect(res.status).toBe(400);
  });

  test('a NON-FINITE rate is rejected (no Infinity/NaN money) — 400', async () => {
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

  test('a valid positive rate yields a finite, correct business-$ (the in-band contract)', async () => {
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
    expect(body.data.businessMileageValue).toBeCloseTo(65.5, 5); // 100 × 0.655, finite
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

/**
 * C214 trips↔odometer lifecycle (T7) — the ratified delete/edit semantics for the D2 linked odometer entry.
 * A trip create writes a deduped `odometer_entries` row at (vehicle, tripDate-day, endOdometer) stamped
 * note='From trip' (createFromTrip). These pin what delete + edit do to THAT row:
 *   1. delete trip, default → KEEP the linked entry (non-destructive default).
 *   2. delete trip ?keepOdometer=false → ALSO remove the linked entry.
 *   3. ?keepOdometer=false must NEVER remove a MANUAL reading at the same (vehicle, day, value) — only the
 *      'From trip' provenance row.
 *   4. edit endOdometer → RE-SYNC: the linked entry moves to the new reading, no stale orphan left.
 */
describe('C214 trips↔odometer lifecycle (T7)', () => {
  /** Count the trip-provenance odometer entries for a vehicle at a given reading. */
  function linkedEntryCount(vehicleId: string, odometer: number): number {
    const row = ctx.sqlite
      .query(
        `SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ? AND odometer = ? AND note = 'From trip'`
      )
      .get(vehicleId, odometer) as { n: number };
    return row.n;
  }

  test('create writes the linked odometer entry (D2 baseline for this block)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/trips', VALID(vehicleId, { endOdometer: 1080 }));
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);
  });

  test('delete trip (default) KEEPS the linked odometer entry (non-destructive default)', async () => {
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
    // The trip is gone but the odometer entry survives (the user keeps their odometer history).
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1);
  });

  test('delete trip ?keepOdometer=false ALSO removes the linked odometer entry', async () => {
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

  test('?keepOdometer=false does NOT remove a MANUAL reading at the same (vehicle, day, value)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // A manual odometer entry at 1080 on the trip's day — distinct provenance (note != 'From trip').
    await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 1080,
      recordedAt: '2024-06-20T13:30:00.000Z',
      note: 'manual log',
    });
    // The trip create DEDUPES onto that same (vehicle, day, value) → no 'From trip' row is written.
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080 })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(0); // no trip-provenance row (deduped)

    const res = await ctx.authed('DELETE', `/api/v1/trips/${data.id}?keepOdometer=false`);
    expect(res.status).toBe(200);
    // The MANUAL reading is untouched — keepOdometer=false only removes a 'From trip' row.
    const manual = ctx.sqlite
      .query(
        `SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ? AND odometer = 1080 AND note = 'manual log'`
      )
      .get(vehicleId) as { n: number };
    expect(manual.n).toBe(1);
  });

  test('edit endOdometer RE-SYNCS the linked entry (moves to the new reading, no stale orphan)', async () => {
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
    // The stale entry at the old reading is gone; a fresh linked entry exists at the new reading.
    expect(linkedEntryCount(vehicleId, 1080)).toBe(0);
    expect(linkedEntryCount(vehicleId, 1200)).toBe(1);
  });

  // The DATE-change re-sync leg (the `dateChanged` arm of the PUT handler) — implemented but the C5/T7
  // block only exercised the endOdometer arm. A trip-date edit must MOVE the linked odometer entry to the
  // new calendar day: the old-day trip-provenance entry is removed, a fresh one lands on the new day (same
  // reading). If the re-sync mis-keyed the delete (it keys on the OLD recordedAt/odometer), the old entry
  // would orphan on the old day → getHistory shows a phantom reading on a date the trip no longer has.
  test('edit tripDate RE-SYNCS the linked entry to the new day (no orphan on the old day)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // Trip on 2024-06-20 at reading 1080.
    const created = await ctx.authed(
      'POST',
      '/api/v1/trips',
      VALID(vehicleId, { endOdometer: 1080, tripDate: '2024-06-20T13:30:00.000Z' })
    );
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    /** trip-provenance entries for this vehicle on a given local calendar day (YYYY-MM-DD). */
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

    // Move the trip to 2024-06-25 (reading unchanged) — the linkage key's DATE moved.
    const res = await ctx.authed('PUT', `/api/v1/trips/${data.id}`, {
      tripDate: '2024-06-25T13:30:00.000Z',
    });
    expect(res.status).toBe(200);
    // The old-day entry is gone; exactly one trip-provenance entry now sits on the new day (still 1080).
    expect(linkedOnDay('2024-06-20')).toBe(0);
    expect(linkedOnDay('2024-06-25')).toBe(1);
    expect(linkedEntryCount(vehicleId, 1080)).toBe(1); // still exactly one such reading, just re-dated
  });
});
