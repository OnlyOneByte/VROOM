import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const seedVehicle = (nickname: string): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname });

describe('analytics routes (real HTTP stack)', () => {
  test('401 without a session (auth middleware gates every analytics route)', async () => {
    const res = await ctx.anon('GET', '/api/v1/analytics/financing');
    expect(res.status).toBe(401);
  });

  test('non-vehicle endpoints return a {success,data} envelope for the authed user', async () => {
    for (const path of ['/api/v1/analytics/financing', '/api/v1/analytics/insurance']) {
      const res = await ctx.authed('GET', path);
      const body = await json<{ success: boolean; data: unknown }>(res);
      expect(res.status, `${path}: ${JSON.stringify(body)}`).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    }
  });

  test('vehicle-tco serves an OWNED vehicle (200 + envelope)', async () => {
    const vehicleId = await seedVehicle('Daily Driver');
    const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('vehicle-tco REJECTS a foreign/nonexistent vehicleId with 404 (no cross-tenant analytics leak)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      '/api/v1/analytics/vehicle-tco?vehicleId=not-my-vehicle-id'
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-health REJECTS a foreign vehicleId with 404 too (same ownership guard)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      '/api/v1/analytics/vehicle-health?vehicleId=someone-elses-vehicle'
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-tco missing the REQUIRED vehicleId is a 400 (query validation)', async () => {
    const res = await ctx.authed('GET', '/api/v1/analytics/vehicle-tco');
    expect(res.status).toBe(400);
  });

  test('fuel-efficiency with NO vehicleId is allowed (the optional-guard branch — all-fleet trend)', async () => {
    const res = await ctx.authed('GET', '/api/v1/analytics/fuel-efficiency');
    const body = await json<{ success: boolean; data: { fuelEfficiencyTrend: unknown } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.fuelEfficiencyTrend).toBeDefined();
  });

  test('fuel-efficiency with a FOREIGN vehicleId is 404 (the guard fires when an id IS supplied)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('GET', '/api/v1/analytics/fuel-efficiency?vehicleId=nope');
    expect(res.status).toBe(404);
  });

  const RANGE = 'startDate=1704067200&endDate=1735689600';

  test('fuel-stats with NO vehicleId returns the all-fleet envelope (optional-guard branch)', async () => {
    const res = await ctx.authed('GET', `/api/v1/analytics/fuel-stats?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('fuel-stats with a FOREIGN vehicleId is 404 (cross-tenant ownership guard)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('GET', `/api/v1/analytics/fuel-stats?${RANGE}&vehicleId=not-mine`);
    expect(res.status).toBe(404);
  });

  test('fuel-advanced with NO vehicleId returns the all-fleet envelope (optional-guard branch)', async () => {
    const res = await ctx.authed('GET', `/api/v1/analytics/fuel-advanced?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('fuel-advanced with a FOREIGN vehicleId is 404 (cross-tenant ownership guard)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/fuel-advanced?${RANGE}&vehicleId=not-mine`
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-expenses serves an OWNED vehicle (200 + envelope)', async () => {
    const vehicleId = await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/vehicle-expenses?${RANGE}&vehicleId=${vehicleId}`
    );
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('vehicle-expenses REJECTS a foreign/nonexistent vehicleId with 404 (no cross-tenant analytics leak)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/vehicle-expenses?${RANGE}&vehicleId=not-my-vehicle-id`
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-expenses missing the REQUIRED vehicleId is a 400 (query validation, before the guard)', async () => {
    const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-expenses?${RANGE}`);
    expect(res.status).toBe(400);
  });

  test('quick-stats: 401 anon / 400 missing range / 200 envelope with a valid range', async () => {
    expect((await ctx.anon('GET', `/api/v1/analytics/quick-stats?${RANGE}`)).status).toBe(401);
    expect((await ctx.authed('GET', '/api/v1/analytics/quick-stats')).status).toBe(400);
    const res = await ctx.authed('GET', `/api/v1/analytics/quick-stats?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('cross-vehicle: 401 anon / 400 missing range / 200 envelope with a valid range', async () => {
    expect((await ctx.anon('GET', `/api/v1/analytics/cross-vehicle?${RANGE}`)).status).toBe(401);
    expect((await ctx.authed('GET', '/api/v1/analytics/cross-vehicle')).status).toBe(400);
    const res = await ctx.authed('GET', `/api/v1/analytics/cross-vehicle?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('year-end: 401 anon / 200 with NO year (defaults to current year, optional param) / 200 with a year', async () => {
    expect((await ctx.anon('GET', '/api/v1/analytics/year-end')).status).toBe(401);
    const noYear = await ctx.authed('GET', '/api/v1/analytics/year-end');
    const noYearBody = await json<{ success: boolean; data: unknown }>(noYear);
    expect(noYear.status, JSON.stringify(noYearBody)).toBe(200);
    expect(noYearBody.success).toBe(true);
    const withYear = await ctx.authed('GET', '/api/v1/analytics/year-end?year=2024');
    expect(withYear.status).toBe(200);
  });

  test('a 0%-APR active loan still appears in loanBreakdown with a principal series', async () => {
    const vehicleId = await seedVehicle('Promo Lease');
    ctx.sqlite.run(
      `INSERT INTO vehicle_financing
         (id, vehicle_id, financing_type, provider, original_amount, apr, term_months, start_date, payment_amount, is_active)
       VALUES ('fin-0apr', ?, 'loan', 'Dealer 0% Promo', 12000, 0, 24, ?, 500, 1)`,
      [vehicleId, Math.floor(new Date('2024-01-01').getTime() / 1000)]
    );
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type, source_id, missed_fillup)
       VALUES ('pay-0apr', ?, ?, 'financial', 500, ?, 'financing', 'fin-0apr', 0)`,
      [vehicleId, ctx.user.id, Math.floor(new Date('2024-02-01').getTime() / 1000)]
    );

    const res = await ctx.authed('GET', '/api/v1/analytics/financing');
    const body =
      await json<
        DataEnvelope<{
          loanBreakdown: Array<{ month: string; interest: number; principal: number }>;
        }>
      >(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    expect(body.data.loanBreakdown.length, 'a 0%-APR loan must not be dropped').toBeGreaterThan(0);
    expect(body.data.loanBreakdown.every((m) => m.interest === 0)).toBe(true);
    expect(body.data.loanBreakdown.some((m) => m.principal > 0)).toBe(true);
  });
});
