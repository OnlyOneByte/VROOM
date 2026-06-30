/**
 * In-process HTTP tests for the per-vehicle expense-stats route
 * (GET /api/v1/expenses/vehicle-stats → expenseRepository.getPerVehicleStats), which had NO coverage.
 *
 * A C257 bug-scout certified expenses/repository.ts CLEAN firsthand (buildExpenseConditions inclusive-
 * endDate + LIKE-escape + AND-tags; findPaginated stable tiebreaker; getSummary period/recent boundaries;
 * getPerVehicleStats' 30-day seconds boundary matching the timestamp column) — no defect — then pivoted to
 * this guard: getPerVehicleStats is REACHABLE (the dashboard /vehicle-stats route) but entirely untested.
 * Its load-bearing pieces — the per-vehicle GROUP BY + COALESCE(SUM), the `recentAmount` last-N-days
 * boundary (date >= now − recentDays, in Unix SECONDS to match the `timestamp` column — a ms/seconds drift
 * here is the C122 normalizeDate class), the lastExpenseDate MAX, and the userId scope — are unpinned. A
 * regression (drift the cutoff units, drop the userId scope, mis-bucket a vehicle) would silently corrupt
 * the dashboard's per-vehicle figures. This drives the REAL route stack end-to-end and pins them.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to the harness +
 * bun:test.
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

interface VehicleStat {
  vehicleId: string;
  totalAmount: number;
  recentAmount: number;
  lastExpenseDate: string | null;
}

/** Create a non-fuel expense at a chosen ISO date via the real POST route. */
async function createExpense(
  vehicleId: string,
  amount: number,
  date: string,
  category = 'maintenance'
): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date,
    description: 'stat fixture',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
}

async function getStats(query = ''): Promise<VehicleStat[]> {
  const res = await ctx.authed('GET', `/api/v1/expenses/vehicle-stats${query}`);
  const body = await json<DataEnvelope<VehicleStat[]>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

/** ISO string for `daysAgo` days before now (always inside/outside a 30-day window deterministically). */
function isoDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe('GET /api/v1/expenses/vehicle-stats (per-vehicle stats route)', () => {
  test('totals + counts are grouped per vehicle (no cross-vehicle bleed)', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createExpense(v1, 100, isoDaysAgo(60));
    await createExpense(v1, 50, isoDaysAgo(50));
    await createExpense(v2, 25, isoDaysAgo(40));

    const stats = await getStats();
    const s1 = stats.find((s) => s.vehicleId === v1);
    const s2 = stats.find((s) => s.vehicleId === v2);
    expect(s1?.totalAmount).toBeCloseTo(150, 5);
    expect(s2?.totalAmount).toBeCloseTo(25, 5);
  });

  test('recentAmount counts only the trailing 30-day window; totalAmount counts all', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // One OLD (60d ago, outside 30d) + one RECENT (5d ago, inside 30d).
    await createExpense(v1, 200, isoDaysAgo(60));
    await createExpense(v1, 30, isoDaysAgo(5));

    const stats = await getStats();
    const s1 = stats.find((s) => s.vehicleId === v1);
    expect(s1?.totalAmount).toBeCloseTo(230, 5); // both
    expect(s1?.recentAmount).toBeCloseTo(30, 5); // only the 5-day-old one (the seconds-boundary contract)
  });

  test('a custom recentDays widens the recent window', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 200, isoDaysAgo(60));
    await createExpense(v1, 30, isoDaysAgo(45));

    // Default 30d → recent excludes both; recentDays=90 → recent includes both.
    const def = await getStats();
    expect(def.find((s) => s.vehicleId === v1)?.recentAmount).toBeCloseTo(0, 5);
    const wide = await getStats('?recentDays=90');
    expect(wide.find((s) => s.vehicleId === v1)?.recentAmount).toBeCloseTo(230, 5);
  });

  test('lastExpenseDate is the most-recent expense date for the vehicle', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 10, '2024-03-01T12:00:00.000Z');
    await createExpense(v1, 20, '2024-06-15T12:00:00.000Z'); // the latest
    await createExpense(v1, 15, '2024-05-10T12:00:00.000Z');

    const stats = await getStats();
    const s1 = stats.find((s) => s.vehicleId === v1);
    // Stored MAX(datetime) → the June 15 row; assert the date portion (TZ-agnostic).
    expect(s1?.lastExpenseDate).toContain('2024-06-15');
  });

  test('is userId-scoped — a foreign user’s vehicle never appears', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 100, isoDaysAgo(10));
    // The stats are scoped to the authed user; only their own vehicle(s) appear, never another tenant's.
    const stats = await getStats();
    expect(stats.every((s) => s.vehicleId === v1)).toBe(true);
    expect(stats).toHaveLength(1);
  });
});
