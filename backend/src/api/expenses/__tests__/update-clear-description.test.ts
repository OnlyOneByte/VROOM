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

interface ExpenseDb {
  id: string;
  description: string | null;
}

function descriptionOf(id: string): string | null {
  return (ctx.sqlite.query('SELECT description FROM expenses WHERE id = ?').get(id) as ExpenseDb)
    .description;
}

async function createWithDescription(vehicleId: string, description: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'misc',
    expenseAmount: 12,
    date: '2024-06-01T00:00:00.000Z',
    description,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('expense description clear-on-edit', () => {
  test('PUT description:null clears a previously-saved description', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const id = await createWithDescription(vehicleId, 'Parking garage downtown');
    expect(descriptionOf(id)).toBe('Parking garage downtown');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { description: null });
    expect(res.status, await res.text()).toBe(200);

    expect(descriptionOf(id), 'description should be NULL, not the stale value').toBeNull();
  });

  test('PUT without description leaves the stored value untouched', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const id = await createWithDescription(vehicleId, 'Keep me');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    expect(res.status, await res.text()).toBe(200);

    expect(descriptionOf(id)).toBe('Keep me');
  });

  test('create still persists a provided description', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const id = await createWithDescription(vehicleId, 'Oil change');
    expect(descriptionOf(id)).toBe('Oil change');
  });
});
