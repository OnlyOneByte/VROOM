import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Yen', model: 'Car', year: 2021 });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const expenseBody = () => ({
  vehicleId,
  category: 'maintenance',
  date: '2024-04-02',
  expenseAmount: 30,
});

function storedAmounts(): number[] {
  return (
    ctx.sqlite.query('SELECT expense_amount AS a FROM expenses ORDER BY created_at').all() as {
      a: number;
    }[]
  ).map((row) => row.a);
}

function changeCurrencyAfterTheFirstScaleRead(code: string) {
  const preferences = repos().preferences;
  const read = preferences.moneyScale.bind(preferences);
  let changed = false;
  return spyOn(preferences, 'moneyScale').mockImplementation(async (userId: string) => {
    const scale = await read(userId);
    if (!changed) {
      changed = true;
      const res = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: code });
      expect(res.status).toBe(200);
    }
    return scale;
  });
}

describe('a currency change landing between a write reading the scale and saving', () => {
  test('the expense write is refused instead of saving at the old scale', async () => {
    const spy = changeCurrencyAfterTheFirstScaleRead('JPY');
    try {
      const raced = await ctx.authed('POST', '/api/v1/expenses', expenseBody());
      expect(raced.status).toBe(409);
      expect(storedAmounts()).toEqual([]);
    } finally {
      spy.mockRestore();
    }

    const retried = await ctx.authed('POST', '/api/v1/expenses', expenseBody());
    expect(retried.status).toBe(201);
    expect(storedAmounts()).toEqual([30]);
  });

  test('without a currency change in between, the write saves at the current scale', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses', expenseBody());
    expect(res.status).toBe(201);
    expect(storedAmounts()).toEqual([3000]);
  });
});
