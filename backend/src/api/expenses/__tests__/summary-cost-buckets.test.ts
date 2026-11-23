import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

interface BucketTotals {
  ownershipTotal: number;
  runningTotal: number;
}

interface CostBuckets extends BucketTotals {
  previous: BucketTotals | null;
  byVehicle: Array<BucketTotals & { vehicleId: string; previous: BucketTotals | null }>;
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function createExpense(vehicleId: string, amount: number, days: number, category: string) {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date: daysAgo(days),
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

async function createSplit(vehicleIds: string[], total: number, days: number, category: string) {
  const res = await ctx.authed('POST', '/api/v1/expenses/split', {
    splitConfig: { method: 'even', vehicleIds },
    category,
    date: daysAgo(days).slice(0, 10),
    totalAmount: total,
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

async function buckets(query: string): Promise<CostBuckets> {
  const res = await ctx.authed('GET', `/api/v1/expenses/summary${query}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<{ costBuckets: CostBuckets }>>(res)).data.costBuckets;
}

async function seedTwoVehiclesTwoPeriods() {
  const camry = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2020 });
  const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2019 });
  await createExpense(camry, 300, 5, 'financial');
  await createExpense(camry, 45.5, 6, 'enhancement');
  await createExpense(camry, 120, 10, 'maintenance');
  await createExpense(civic, 80, 3, 'regulatory');
  await createExpense(camry, 300, 40, 'financial');
  await createExpense(camry, 40, 41, 'enhancement');
  await createExpense(civic, 250, 45, 'financial');
  await createExpense(camry, 999, 120, 'enhancement');
  await createSplit([camry, civic], 60, 8, 'misc');
  await createSplit([camry, civic], 200, 50, 'financial');
  return { camry, civic };
}

describe('GET /expenses/summary cost buckets', () => {
  test('splits the last 30 days and the 30 before into ownership and running, overall and per vehicle', async () => {
    const { camry, civic } = await seedTwoVehiclesTwoPeriods();

    const result = await buckets('?period=30d');

    expect(result).toMatchObject({ ownershipTotal: 300, runningTotal: 305.5 });
    expect(result.previous).toEqual({ ownershipTotal: 750, runningTotal: 40 });
    const byVehicle = Object.fromEntries(result.byVehicle.map((row) => [row.vehicleId, row]));
    expect(byVehicle[camry]).toEqual({
      vehicleId: camry,
      ownershipTotal: 300,
      runningTotal: 195.5,
      previous: { ownershipTotal: 400, runningTotal: 40 },
    });
    expect(byVehicle[civic]).toEqual({
      vehicleId: civic,
      ownershipTotal: 0,
      runningTotal: 110,
      previous: { ownershipTotal: 350, runningTotal: 0 },
    });
  });

  test('one vehicle narrows every bucket to it', async () => {
    const { civic } = await seedTwoVehiclesTwoPeriods();

    const result = await buckets(`?period=30d&vehicleId=${civic}`);

    expect(result).toMatchObject({ ownershipTotal: 0, runningTotal: 110 });
    expect(result.previous).toEqual({ ownershipTotal: 350, runningTotal: 0 });
    expect(result.byVehicle.map((row) => row.vehicleId)).toEqual([civic]);
  });

  test('all time has no previous period and counts everything', async () => {
    await seedTwoVehiclesTwoPeriods();

    const result = await buckets('?period=all');

    expect(result).toMatchObject({ ownershipTotal: 1050, runningTotal: 1344.5, previous: null });
    expect(result.byVehicle.every((row) => row.previous === null)).toBe(true);
  });

  test('the buckets add up to the period total', async () => {
    await seedTwoVehiclesTwoPeriods();
    const res = await ctx.authed('GET', '/api/v1/expenses/summary?period=90d');
    const summary = (
      await json<DataEnvelope<{ totalAmount: number; costBuckets: CostBuckets }>>(res)
    ).data;

    expect(summary.costBuckets.ownershipTotal + summary.costBuckets.runningTotal).toBeCloseTo(
      summary.totalAmount,
      5
    );
  });
});
