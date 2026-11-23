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

  test('an IANA timeZone is accepted and an unknown one is a 400', async () => {
    const ok = await ctx.authed('GET', '/api/v1/analytics/insurance?timeZone=Pacific%2FAuckland');
    expect(ok.status, await ok.text()).toBe(200);
    for (const path of [
      '/api/v1/analytics/insurance?timeZone=Mars%2FOlympus',
      '/api/v1/analytics/year-end?timeZone=Mars%2FOlympus',
      '/api/v1/analytics/cross-vehicle?startDate=1&endDate=2&timeZone=Mars%2FOlympus',
    ]) {
      const bad = await ctx.authed('GET', path);
      expect(bad.status, path).toBe(400);
    }
  });

  test('vehicle-tco serves an OWNED vehicle (200 + envelope)', async () => {
    const vehicleId = await seedVehicle(ctx, { nickname: 'Daily Driver' });
    const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('vehicle-tco REJECTS a foreign/nonexistent vehicleId with 404 (no cross-tenant analytics leak)', async () => {
    await seedVehicle(ctx, { nickname: 'Daily Driver' });
    const res = await ctx.authed(
      'GET',
      '/api/v1/analytics/vehicle-tco?vehicleId=not-my-vehicle-id'
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-health REJECTS a foreign vehicleId with 404 too (same ownership guard)', async () => {
    await seedVehicle(ctx, { nickname: 'Daily Driver' });
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

  test('vehicle-health missing the REQUIRED vehicleId is a 400 (query validation)', async () => {
    const res = await ctx.authed('GET', '/api/v1/analytics/vehicle-health');
    expect(res.status).toBe(400);
  });

  test('a non-positive or non-integer year is a 400 on year-end and vehicle-tco', async () => {
    const vehicleId = await seedVehicle(ctx, { nickname: 'Daily Driver' });
    for (const year of ['abc', '-1', '0', '3.5']) {
      const yearEnd = await ctx.authed('GET', `/api/v1/analytics/year-end?year=${year}`);
      expect(yearEnd.status, `year-end year=${year}`).toBe(400);
      const tco = await ctx.authed(
        'GET',
        `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}&year=${year}`
      );
      expect(tco.status, `vehicle-tco year=${year}`).toBe(400);
    }
  });

  test('fuel-efficiency with NO vehicleId is allowed (the optional-guard branch — all-fleet trend)', async () => {
    const res = await ctx.authed('GET', '/api/v1/analytics/fuel-efficiency');
    const body = await json<{ success: boolean; data: { fuelEfficiencyTrend: unknown } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.fuelEfficiencyTrend).toBeDefined();
  });

  test('fuel-efficiency with a FOREIGN vehicleId is 404 (the guard fires when an id IS supplied)', async () => {
    await seedVehicle(ctx, { nickname: 'Daily Driver' });
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
    await seedVehicle(ctx, { nickname: 'Daily Driver' });
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
    await seedVehicle(ctx, { nickname: 'Daily Driver' });
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/fuel-advanced?${RANGE}&vehicleId=not-mine`
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-expenses serves an OWNED vehicle (200 + envelope)', async () => {
    const vehicleId = await seedVehicle(ctx, { nickname: 'Daily Driver' });
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
    await seedVehicle(ctx, { nickname: 'Daily Driver' });
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

  test('query: 401 anon / 400 bad params / 200 envelope with defaults', async () => {
    expect((await ctx.anon('GET', '/api/v1/analytics/query?metric=cost')).status).toBe(401);
    for (const bad of [
      'metric=speed',
      'metric=efficiency&groupBy=category',
      'metric=distance&groupBy=tag',
      'metric=cost&start=1735689600&end=1704067200',
      'metric=cost&categories=fuel,petrol',
      'metric=cost&interval=week&start=946684800&end=1735689600',
      'metric=cost&timeZone=Mars%2FOlympus',
    ]) {
      const res = await ctx.authed('GET', `/api/v1/analytics/query?${bad}`);
      expect(res.status, bad).toBe(400);
    }
    const vehicleId = await seedVehicle(ctx, { nickname: 'Daily Driver' });
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/query?metric=cost&groupBy=category&vehicleIds=${vehicleId},not-mine&categories=fuel,maintenance&${'start=1704067200&end=1735689600'}`
    );
    const body = await json<{
      success: boolean;
      data: { interval: string; buckets: string[]; series: unknown[]; compare: unknown };
    }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.interval).toBe('month');
    expect(body.data.buckets).toHaveLength(12);
    expect(body.data.series).toEqual([]);
    expect(body.data.compare).toBeNull();
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
    const vehicleId = await seedVehicle(ctx, { nickname: 'Promo Lease' });
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

describe('analytics date range and year parameters', () => {
  const JAN_2025 = 1_735_689_600;
  const JAN_2026 = 1_767_225_600;

  test('a seconds range in order is accepted on every range route', async () => {
    const vehicleId = await seedVehicle(ctx);
    const range = `startDate=${JAN_2025}&endDate=${JAN_2026}`;
    for (const path of [
      `/api/v1/analytics/summary?${range}&ytdStart=${JAN_2026}`,
      `/api/v1/analytics/quick-stats?${range}`,
      `/api/v1/analytics/fuel-stats?${range}`,
      `/api/v1/analytics/cross-vehicle?${range}`,
      `/api/v1/analytics/fuel-advanced?${range}`,
      `/api/v1/analytics/vehicle-expenses?${range}&vehicleId=${vehicleId}`,
    ]) {
      const res = await ctx.authed('GET', path);
      expect(res.status, `${path}: ${await res.text()}`).toBe(200);
    }
  });

  const rangeRoutes = ['/api/v1/analytics/summary', '/api/v1/analytics/fuel-stats'];

  test.each([
    ['milliseconds', `startDate=${JAN_2025 * 1000}&endDate=${JAN_2026 * 1000}`, rangeRoutes],
    ['a reversed range', `startDate=${JAN_2026}&endDate=${JAN_2025}`, rangeRoutes],
    ['an empty range', `startDate=${JAN_2025}&endDate=${JAN_2025}`, rangeRoutes],
    [
      'a millisecond ytdStart',
      `startDate=${JAN_2025}&endDate=${JAN_2026}&ytdStart=${JAN_2026 * 1000}`,
      ['/api/v1/analytics/summary'],
    ],
  ])('%s is a 400', async (_label, query, paths) => {
    for (const path of paths) {
      const res = await ctx.authed('GET', `${path}?${query}`);
      expect(res.status, `${path}?${query}: ${await res.text()}`).toBe(400);
    }
  });

  test('milliseconds and far-future seconds get their own messages', async () => {
    const milliseconds = 'Dates are epoch seconds, not milliseconds';
    const tooLate = 'Dates can be at most the end of next year';
    const farFuture = Date.UTC(new Date().getUTCFullYear() + 5, 0, 1) / 1000;
    for (const [endDate, message, notMessage] of [
      [JAN_2026 * 1000, milliseconds, tooLate],
      [farFuture, tooLate, milliseconds],
    ] as const) {
      const res = await ctx.authed(
        'GET',
        `/api/v1/analytics/fuel-stats?startDate=${JAN_2025}&endDate=${endDate}`
      );
      const body = await res.text();
      expect(res.status, body).toBe(400);
      expect(body).toContain(message);
      expect(body).not.toContain(notMessage);
    }
  });

  test('year must be between 1900 and next year', async () => {
    const vehicleId = await seedVehicle(ctx);
    const nextYear = new Date().getUTCFullYear() + 1;
    for (const [query, expected] of [
      [`year=${nextYear}`, 200],
      ['year=1900', 200],
      ['year=999999', 400],
      [`year=${nextYear + 1}`, 400],
      ['year=1899', 400],
    ] as const) {
      const yearEnd = await ctx.authed('GET', `/api/v1/analytics/year-end?${query}`);
      expect(yearEnd.status, `year-end ${query}: ${await yearEnd.text()}`).toBe(expected);
      const tco = await ctx.authed(
        'GET',
        `/api/v1/analytics/vehicle-tco?${query}&vehicleId=${vehicleId}`
      );
      expect(tco.status, `vehicle-tco ${query}: ${await tco.text()}`).toBe(expected);
    }
  });
});
