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

const RANGE = '?startDate=1704067200&endDate=1735689600';

const UNIT_READING_ENDPOINTS = [
  `/api/v1/analytics/summary${RANGE}`,
  `/api/v1/analytics/quick-stats${RANGE}`,
  `/api/v1/analytics/cross-vehicle${RANGE}`,
  '/api/v1/analytics/year-end?year=2024',
  `/api/v1/analytics/fuel-stats${RANGE}`,
  `/api/v1/analytics/fuel-advanced${RANGE}`,
];

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
      expect(body.error.message, path).toContain(vehicleId);
      expect(body.error.details, path).toBeUndefined();
    }
  });

  test('the same endpoints all answer 200 once the preferences parse', async () => {
    await seedVehicle(ctx, { nickname: 'Fine' });
    for (const path of UNIT_READING_ENDPOINTS) {
      const res = await ctx.authed('GET', path);
      expect(res.status, `${path} should be unaffected by the guard above`).toBe(200);
    }
  });
});
