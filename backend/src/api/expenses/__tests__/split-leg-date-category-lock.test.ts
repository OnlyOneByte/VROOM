import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

function rowOf(id: string): { date: number; category: string } {
  return ctx.sqlite.query('SELECT date, category FROM expenses WHERE id = ?').get(id) as {
    date: number;
    category: string;
  };
}

async function createSplitLegs(): Promise<string[]> {
  const vehicleIds = [
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 }),
    await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 }),
  ];
  const res = await ctx.authed('POST', '/api/v1/expenses/split', {
    splitConfig: { method: 'even', vehicleIds },
    category: 'maintenance',
    date: '2024-02-01T00:00:00.000Z',
    totalAmount: 30,
  });
  const body = await json<{ data: { siblings: Array<{ id: string }> } }>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.siblings.map((s) => s.id);
}

describe('PUT /expenses/:id on a split leg', () => {
  test('rejects a date change that would move one leg away from its siblings', async () => {
    const [legId = ''] = await createSplitLegs();
    const before = rowOf(legId);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, {
      date: '2024-03-01T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(rowOf(legId)).toEqual(before);
  });

  test('rejects a category change on one leg', async () => {
    const [legId = ''] = await createSplitLegs();

    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, { category: 'financial' });

    expect(res.status).toBe(400);
    expect(rowOf(legId).category).toBe('maintenance');
  });

  test('accepts the unchanged date and category alongside a description edit', async () => {
    const [legId = ''] = await createSplitLegs();

    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, {
      date: '2024-02-01T00:00:00.000Z',
      category: 'maintenance',
      description: 'Wipers',
    });

    expect(res.status, await res.text()).toBe(200);
  });
});

describe('PUT /expenses/:id on an insurance term expense', () => {
  test('accepts a resent date that differs from the stored one only by milliseconds', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 120,
      date: '2024-06-01T08:30:15.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    ctx.sqlite
      .query("UPDATE expenses SET source_type = 'insurance_term', source_id = 't1' WHERE id = ?")
      .run(body.data.id);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, {
      date: '2024-06-01T08:30:15.123Z',
      description: 'Six-month premium',
    });

    expect(res.status, await res.text()).toBe(200);
  });
});
