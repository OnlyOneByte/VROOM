import { describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
import { json, useTestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

const RANGE = 'start=1704067200&end=1735689600';

describe('analytics totals from raw-SQL sums', () => {
  const ctx = useTestApp();

  async function seedExpenses(): Promise<void> {
    const vehicleId = await seedVehicle(ctx());
    for (const [category, expenseAmount, day] of [
      ['maintenance', 8000, 10],
      ['maintenance', 2000, 11],
      ['fuel', 4000, 12],
    ] as const) {
      await repos().expenses.create({
        vehicleId,
        userId: ctx().user.id,
        category,
        date: new Date(Date.UTC(2024, 5, day, 12)),
        expenseAmount,
        mileage: 1000 + day * 100,
        volume: category === 'fuel' ? 10 : undefined,
      } as Parameters<ReturnType<typeof repos>['expenses']['create']>[0]);
    }
  }

  test('the query total adds every category as numbers', async () => {
    await seedExpenses();
    const res = await ctx().authed(
      'GET',
      `/api/v1/analytics/query?metric=cost&${RANGE}&include=all&interval=none&groupBy=category`
    );
    expect(res.status).toBe(200);
    const body = await json<{ data: { totals: { value: number } } }>(res);
    expect(body.data.totals.value).toBe(140);
  });

  test('the items totals are numbers', async () => {
    await seedExpenses();
    const res = await ctx().authed('GET', `/api/v1/analytics/query/items?${RANGE}&include=all`);
    expect(res.status).toBe(200);
    const body = await json<{
      data: { total: number; fuel: { total: number } | null; items: { amount: number }[] };
    }>(res);
    expect(body.data.total).toBe(140);
    expect(body.data.fuel?.total).toBe(40);
    expect(body.data.items.map((item) => item.amount)).toEqual([80, 20]);
  });
});
