/**
 * In-process HTTP test for GET /api/v1/expenses/summary through the REAL stack.
 *
 * Regression guard for the dashboard/analytics "blank charts + $0 monthly average"
 * bug: `expenses.date` is an integer timestamp (unix SECONDS), but the monthly-trend
 * GROUP BY used `strftime('%Y-%m', date)` WITHOUT the 'unixepoch' modifier — SQLite
 * then reads the integer as a Julian day, so the period buckets came out wrong/empty.
 * Empty monthlyTrend → blank trend chart AND computeMonthlyAverage span garbage → $0.
 *
 * This asserts the summary actually buckets expenses into the correct YYYY-MM months
 * and returns a sane monthly average — which only holds once strftime uses 'unixepoch'.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

interface SummaryBody {
  totalAmount: number;
  monthlyAverage: number;
  categoryBreakdown: { category: string; amount: number; count: number }[];
  monthlyTrend: { period: string; amount: number; count: number }[];
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function createExpense(
  vehicleId: string,
  amount: number,
  isoDate: string,
  category = 'misc'
) {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date: isoDate,
    description: `seed ${isoDate}`,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('GET /expenses/summary — monthly bucketing (unixepoch regression)', () => {
  test('buckets expenses into correct YYYY-MM months and computes a sane average', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2021 });
    // Two expenses in 2026-01, one in 2026-03 → 3-month calendar span (Jan..Mar).
    await createExpense(vehicleId, 100, '2026-01-10T12:00:00.000Z');
    await createExpense(vehicleId, 50, '2026-01-20T12:00:00.000Z');
    await createExpense(vehicleId, 30, '2026-03-15T12:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/summary?period=all');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<SummaryBody>>(res);
    const s = body.data;

    expect(s.totalAmount).toBe(180);

    // The bug produced wrong/empty period buckets. Correct behavior: two month rows
    // with real YYYY-MM keys and the right per-month sums.
    const byPeriod = Object.fromEntries(s.monthlyTrend.map((t) => [t.period, t.amount]));
    expect(s.monthlyTrend.length).toBe(2);
    expect(byPeriod['2026-01']).toBe(150);
    expect(byPeriod['2026-03']).toBe(30);
    // Every period must be a real 'YYYY-MM' (the bug yielded null/garbage keys).
    for (const t of s.monthlyTrend) {
      expect(t.period).toMatch(/^\d{4}-\d{2}$/);
    }

    // monthlyAverage = total / calendar months spanned (Jan..Mar = 3) = 180/3 = 60.
    expect(s.monthlyAverage).toBeCloseTo(60, 5);
  });

  test('category breakdown buckets by category with correct sums', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2021 });
    await createExpense(vehicleId, 40, '2026-02-01T12:00:00.000Z', 'maintenance');
    await createExpense(vehicleId, 60, '2026-02-02T12:00:00.000Z', 'maintenance');
    await createExpense(vehicleId, 25, '2026-02-03T12:00:00.000Z', 'misc');

    const res = await ctx.authed('GET', '/api/v1/expenses/summary?period=all');
    const s = (await json<DataEnvelope<SummaryBody>>(res)).data;

    const byCat = Object.fromEntries(s.categoryBreakdown.map((c) => [c.category, c.amount]));
    expect(byCat.maintenance).toBe(100);
    expect(byCat.misc).toBe(25);
  });
});
