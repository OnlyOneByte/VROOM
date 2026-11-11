/**
 * currentOdometer on GET /vehicles/:id/stats is the all-time reading across all sources. Unlike
 * currentMileage it is independent of the period and includes manual odometer entries.
 * createTestApp() must run before any static config or connection import, so keep imports to the
 * harness and bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const INITIAL_MILEAGE = 10000;
const seedVehicleAtInitialMileage = (): Promise<string> =>
  seedVehicle(ctx, { extra: { initialMileage: INITIAL_MILEAGE } });

async function addFuelExpense(vehicleId: string, mileage: number, isoDate: string): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'fuel',
    expenseAmount: 40,
    date: isoDate,
    mileage,
    volume: 10,
    fuelType: 'regular',
  });
  expect(res.status, await res.text()).toBeLessThan(300);
}

async function addOdometerEntry(
  vehicleId: string,
  odometer: number,
  isoDate: string
): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: isoDate,
  });
  expect(res.status, await res.text()).toBeLessThan(300);
}

interface StatsResponse {
  data: { period: string; currentMileage: number | null; currentOdometer: number | null };
}

async function getStats(vehicleId: string, period: string): Promise<StatsResponse['data']> {
  const res = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}/stats?period=${period}`);
  const body = await json<StatsResponse>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

describe('GET /vehicles/:id/stats — currentOdometer', () => {
  test('currentOdometer ignores the period while currentMileage is period-scoped', async () => {
    const id = await seedVehicleAtInitialMileage();
    await addFuelExpense(id, 12000, '2020-01-01T00:00:00.000Z');
    await addFuelExpense(id, 30000, new Date().toISOString());

    const all = await getStats(id, 'all');
    expect(all.currentMileage).toBe(30000);
    expect(all.currentOdometer).toBe(30000);

    const week = await getStats(id, '7d');
    expect(week.currentOdometer, 'currentOdometer must not change with period').toBe(30000);
  });

  test('a short window that excludes all fuel rows nulls currentMileage but not currentOdometer', async () => {
    const id = await seedVehicleAtInitialMileage();
    await addFuelExpense(id, 12000, '2019-01-01T00:00:00.000Z');
    await addFuelExpense(id, 20000, '2019-06-01T00:00:00.000Z');

    const week = await getStats(id, '7d');
    expect(week.currentMileage).toBeNull();
    expect(week.currentOdometer).toBe(20000);
  });

  test('currentOdometer includes manual odometer entries that currentMileage ignores', async () => {
    const id = await seedVehicleAtInitialMileage();
    await addFuelExpense(id, 15000, new Date().toISOString());
    await addOdometerEntry(id, 18000, new Date().toISOString());

    const all = await getStats(id, 'all');
    expect(all.currentMileage, 'fuel-only stat ignores manual entries').toBe(15000);
    expect(all.currentOdometer, 'all-sources MAX includes the manual 18000').toBe(18000);
  });

  test('currentOdometer is null when the vehicle has no readings on either source', async () => {
    const id = await seedVehicleAtInitialMileage();
    const all = await getStats(id, 'all');
    expect(all.currentMileage).toBeNull();
    expect(all.currentOdometer).toBeNull();
  });
});

// The stats response is hand-assembled in the route with no type link to the frontend VehicleStats.
// This set mirrors that frontend type exactly. Change it together with the type and the route. The
// check is two-sided, so a dropped field and an unmirrored extra field both fail.
const EXPECTED_STATS_FIELDS = [
  'period',
  'totalMileage',
  'currentMileage',
  'currentOdometer',
  'totalFuelConsumed',
  'totalChargeConsumed',
  'averageMpg',
  'averageMilesPerKwh',
  'totalFuelCost',
  'totalChargeCost',
  'costPerMile',
  'fuelExpenseCount',
  'chargeExpenseCount',
].sort();

async function getRawStatsData(
  vehicleId: string,
  period: string
): Promise<Record<string, unknown>> {
  const res = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}/stats?period=${period}`);
  const body = await json<{ data: Record<string, unknown> }>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

describe('GET /vehicles/:id/stats — response field set matches the frontend contract', () => {
  test('a populated vehicle returns exactly the frontend VehicleStats field set', async () => {
    const id = await seedVehicleAtInitialMileage();
    await addFuelExpense(id, 20000, new Date().toISOString());
    await addOdometerEntry(id, 25000, new Date().toISOString());

    const data = await getRawStatsData(id, 'all');
    expect(Object.keys(data).sort()).toEqual(EXPECTED_STATS_FIELDS);
  });

  test('an empty vehicle returns the same field set', async () => {
    const id = await seedVehicleAtInitialMileage();
    const data = await getRawStatsData(id, 'all');
    expect(Object.keys(data).sort()).toEqual(EXPECTED_STATS_FIELDS);
  });

  test('the field set is identical across every period', async () => {
    const id = await seedVehicleAtInitialMileage();
    await addFuelExpense(id, 18000, '2020-01-01T00:00:00.000Z');
    for (const period of ['7d', '30d', '90d', '1y', 'all']) {
      const data = await getRawStatsData(id, period);
      expect(Object.keys(data).sort(), `period=${period}`).toEqual(EXPECTED_STATS_FIELDS);
    }
  });
});
