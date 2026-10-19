/**
 * Guard: a vehicle whose stored `unit_preferences` do not parse must answer 400 on EVERY analytics
 * endpoint that reads them — never 500.
 *
 * `getAllVehicleUnits` deliberately throws a ValidationError naming the offending vehicle instead
 * of falling back to defaults, because silently defaulting would report a litres/kilometres vehicle
 * in miles/gallons. That contract only reaches the user if each endpoint's catch block rethrows it:
 * the fuel-stats and fuel-advanced catches wrapped it in a DatabaseError, so the Fuel tab answered
 * 500 `{"code":"DatabaseError"}` (leaking `details.statusCode: 400`) and swallowed the vehicle id
 * the user needed to fix their data, while the other four endpoints answered the actionable 400.
 *
 * The vector is not the API: POST/PUT /vehicles validates unitPreferences with zod. A restore from a
 * hand-edited backup, or a third-party import writing the short unit spellings (`"mi"`, `"gal"`),
 * lands a row shaped like the one seeded below.
 *
 * createTestApp() must run before static config/connection imports — keep imports to the harness.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

/** Epoch seconds, the unit the date-range query schemas coerce to. */
const RANGE = '?startDate=1704067200&endDate=1735689600';

/**
 * Every analytics endpoint that reads vehicle unit preferences. The whole point of the guard is
 * that a NEW one cannot drift from the contract, so keep this list complete.
 */
const UNIT_READING_ENDPOINTS = [
  `/api/v1/analytics/summary${RANGE}`,
  `/api/v1/analytics/quick-stats${RANGE}`,
  `/api/v1/analytics/cross-vehicle${RANGE}`,
  '/api/v1/analytics/year-end?year=2024',
  `/api/v1/analytics/fuel-stats${RANGE}`,
  `/api/v1/analytics/fuel-advanced${RANGE}`,
];

/** Valid JSON that is NOT a valid UnitPreferences — the short spellings an importer emits. */
const INVALID_UNIT_PREFERENCES = '{"distanceUnit":"mi","volumeUnit":"gal","chargeUnit":"kWh"}';

describe('unparseable vehicle unit preferences', () => {
  test('answer 400 naming the vehicle on every unit-reading endpoint', async () => {
    const vehicleId = await seedVehicle(ctx, { nickname: 'Imported' });
    ctx.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      INVALID_UNIT_PREFERENCES,
      vehicleId,
    ]);

    for (const path of UNIT_READING_ENDPOINTS) {
      const res = await ctx.authed('GET', path);
      const body = await json<ErrorBody>(res);
      expect(res.status, `${path}: ${JSON.stringify(body)}`).toBe(400);
      expect(body.error.code, path).toBe('ValidationError');
      // The message must name WHICH vehicle to fix — that is the whole value of the 400.
      expect(body.error.message, path).toContain(vehicleId);
      // A 500 envelope leaked `details: { statusCode: 400, isOperational: true }`, advertising
      // that the real error was a client error.
      expect(body.error.details, path).toBeUndefined();
    }
  });

  test('the same endpoints all answer 200 once the preferences parse (the probe is live)', async () => {
    await seedVehicle(ctx, { nickname: 'Fine' });
    for (const path of UNIT_READING_ENDPOINTS) {
      const res = await ctx.authed('GET', path);
      expect(res.status, `${path} should be unaffected by the guard above`).toBe(200);
    }
  });
});
