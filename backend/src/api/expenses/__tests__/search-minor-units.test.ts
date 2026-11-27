import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Yen', model: 'Car', year: 2021 });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function addExpense(expenseAmount: number): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount,
    date: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status).toBe(201);
}

async function found(search: string): Promise<number[]> {
  const res = await ctx.authed('GET', `/api/v1/expenses?search=${encodeURIComponent(search)}`);
  const body = await json<PaginatedEnvelope<{ expenseAmount: number }>>(res);
  return body.data.map((e) => e.expenseAmount);
}

describe('search by amount uses the owner’s minor unit', () => {
  test('a yen user finds ¥1234 by 1234, not by 12.34', async () => {
    const settings = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'JPY' });
    expect(settings.status).toBe(200);
    await addExpense(1234);
    await addExpense(12);

    expect(await found('1234')).toEqual([1234]);
    expect(await found('¥1,234')).toEqual([1234]);
    expect(await found('12.34')).toEqual([]);
    expect(await found('12.00')).toEqual([12]);

    const months = await ctx.authed('GET', '/api/v1/expenses/monthly-totals?search=1234');
    const totals = await json<DataEnvelope<{ amount: number }[]>>(months);
    expect(totals.data.map((m) => m.amount)).toEqual([1234]);

    const exported = async (search: string) => {
      const res = await ctx.authed(
        'GET',
        `/api/v1/expenses/export?search=${encodeURIComponent(search)}`
      );
      expect(res.status).toBe(200);
      return (await res.text()).trim().split('\n').length - 1;
    };
    expect(await exported('1234')).toBe(1);
    expect(await exported('12.34')).toBe(0);
  });

  test('a dollar user still finds cents exactly and whole dollars as a range', async () => {
    await addExpense(12.34);
    await addExpense(12.99);

    expect(await found('12.34')).toEqual([12.34]);
    expect((await found('12')).sort()).toEqual([12.34, 12.99]);
  });
});
