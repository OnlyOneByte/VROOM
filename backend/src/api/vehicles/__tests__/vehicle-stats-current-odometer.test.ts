/**
 * In-process HTTP tests for the `currentOdometer` field on GET /vehicles/:id/stats
 * (maintenance-schedule T3 part 3 — the deferred vehicle-stats reconcile).
 *
 * `currentMileage` is period-filtered + fuel-only (MAX over the filtered fuel
 * expenses), so it drops under a short window and never sees manual odometer
 * entries. `currentOdometer` is the canonical ALL-TIME, ALL-SOURCES reading (the
 * D2 getCurrentOdometer helper) — the value a consumer that needs the true
 * odometer (lease overage, loan miles-used) should use. These tests pin the two
 * properties that distinguish it from currentMileage: period-independence and
 * cross-source MAX (manual entries included). createTestApp() must run before any
 * static config/connection import — keep imports to the harness + bun:test only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    initialMileage: 10000,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

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

describe('GET /vehicles/:id/stats — currentOdometer (T3 part 3 reconcile)', () => {
  test('currentOdometer is period-INDEPENDENT while currentMileage is period-scoped', async () => {
    const id = await seedVehicle();
    // An OLD fuel reading (outside a 7d window) and a RECENT one.
    await addFuelExpense(id, 12000, '2020-01-01T00:00:00.000Z');
    await addFuelExpense(id, 30000, new Date().toISOString());

    // 'all' sees both → currentMileage is the recent MAX; currentOdometer matches.
    const all = await getStats(id, 'all');
    expect(all.currentMileage).toBe(30000);
    expect(all.currentOdometer).toBe(30000);

    // '7d' drops the 2020 reading from the fuel slice. currentMileage reflects only
    // the filtered fuel (here still 30000 — the recent one is in-window), but the
    // KEY property: currentOdometer is the same all-time value regardless of period.
    const week = await getStats(id, '7d');
    expect(week.currentOdometer, 'currentOdometer must not change with period').toBe(30000);
  });

  test('a short window that excludes ALL fuel rows zeroes currentMileage but NOT currentOdometer', async () => {
    const id = await seedVehicle();
    // Both fuel rows are old → a 7d window filters them ALL out.
    await addFuelExpense(id, 12000, '2019-01-01T00:00:00.000Z');
    await addFuelExpense(id, 20000, '2019-06-01T00:00:00.000Z');

    const week = await getStats(id, '7d');
    // No in-window fuel → currentMileage has nothing to MAX over (null).
    expect(week.currentMileage).toBeNull();
    // ...but the vehicle's true odometer is still known all-time.
    expect(week.currentOdometer).toBe(20000);
  });

  test('currentOdometer includes MANUAL odometer entries that currentMileage ignores', async () => {
    const id = await seedVehicle();
    await addFuelExpense(id, 15000, new Date().toISOString());
    // A manual reading HIGHER than any fuel mileage (the case currentMileage misses).
    await addOdometerEntry(id, 18000, new Date().toISOString());

    const all = await getStats(id, 'all');
    expect(all.currentMileage, 'fuel-only stat ignores manual entries').toBe(15000);
    expect(all.currentOdometer, 'all-sources MAX includes the manual 18000').toBe(18000);
  });

  test('currentOdometer is null when the vehicle has no readings on either source', async () => {
    const id = await seedVehicle();
    const all = await getStats(id, 'all');
    expect(all.currentMileage).toBeNull();
    expect(all.currentOdometer).toBeNull();
  });
});
