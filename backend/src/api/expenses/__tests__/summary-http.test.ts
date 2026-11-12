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

describe('GET /expenses/summary — monthly bucketing', () => {
  test('buckets expenses into correct YYYY-MM months and computes a sane average', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2021 });
    await createExpense(vehicleId, 100, '2026-01-10T12:00:00.000Z');
    await createExpense(vehicleId, 50, '2026-01-20T12:00:00.000Z');
    await createExpense(vehicleId, 30, '2026-03-15T12:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses/summary?period=all');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<SummaryBody>>(res);
    const s = body.data;

    expect(s.totalAmount).toBe(180);

    const byPeriod = Object.fromEntries(s.monthlyTrend.map((t) => [t.period, t.amount]));
    expect(s.monthlyTrend.length).toBe(2);
    expect(byPeriod['2026-01']).toBe(150);
    expect(byPeriod['2026-03']).toBe(30);
    for (const t of s.monthlyTrend) {
      expect(t.period).toMatch(/^\d{4}-\d{2}$/);
    }

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

describe('GET /expenses/summary — vehicleId scoping', () => {
  test('?vehicleId scopes totals + category breakdown to that vehicle only', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2022 });
    await createExpense(v1, 100, '2026-02-01T12:00:00.000Z', 'maintenance');
    await createExpense(v1, 40, '2026-02-02T12:00:00.000Z', 'misc');
    await createExpense(v2, 999, '2026-02-03T12:00:00.000Z', 'maintenance');

    const res = await ctx.authed('GET', `/api/v1/expenses/summary?period=all&vehicleId=${v1}`);
    const s = (await json<DataEnvelope<SummaryBody>>(res)).data;

    expect(res.status).toBe(200);
    expect(s.totalAmount).toBe(140);
    const byCat = Object.fromEntries(s.categoryBreakdown.map((c) => [c.category, c.amount]));
    expect(byCat.maintenance).toBe(100);
    expect(byCat.misc).toBe(40);
  });

  test('a summary scoped to an UNOWNED vehicle is 404 (ownership-checked)', async () => {
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('u2sum', 'sum@x.com', 'Other')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2sum', 'u2sum', 'Honda', 'Civic', 2020)`
    );
    const res = await ctx.authed('GET', '/api/v1/expenses/summary?period=all&vehicleId=v2sum');
    expect(res.status).toBe(404);
  });
});
