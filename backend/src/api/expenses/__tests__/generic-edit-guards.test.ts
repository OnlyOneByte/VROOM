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

interface ExpenseRow {
  expense_amount: number;
  group_total: number | null;
  description: string | null;
}

async function rowOf(id: string): Promise<ExpenseRow | null> {
  return (await ctx.sql.get(
    'SELECT expense_amount, group_total, description FROM expenses WHERE id = ?',
    [id]
  )) as ExpenseRow | null;
}

async function createSplit(): Promise<{ legIds: string[]; vehicleIds: string[] }> {
  const vehicleIds = [
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 }),
    await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 }),
    await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2023 }),
  ];
  const res = await ctx.authed('POST', '/api/v1/expenses/split', {
    splitConfig: { method: 'even', vehicleIds: vehicleIds.slice(0, 2) },
    category: 'maintenance',
    date: '2024-02-01',
    totalAmount: 30,
  });
  const body = await json<{ data: { siblings: Array<{ id: string }> } }>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { legIds: body.data.siblings.map((s) => s.id), vehicleIds };
}

async function createSourcedExpense(sourceType: string): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'financial',
    expenseAmount: 120,
    date: '2024-06-01T00:00:00.000Z',
    description: 'Premium',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  await ctx.sql.run('UPDATE expenses SET source_type = ?, source_id = ? WHERE id = ?', [
    sourceType,
    'source-1',
    body.data.id,
  ]);
  return body.data.id;
}

describe('PUT /expenses/:id on a split leg', () => {
  test('rejects an amount change that would leave groupTotal stale', async () => {
    const { legIds } = await createSplit();
    const legId = legIds[0] ?? '';

    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, { expenseAmount: 25 });

    expect(res.status).toBe(400);
    expect(await rowOf(legId)).toMatchObject({ expense_amount: 1500, group_total: 3000 });
  });

  test('rejects moving the leg to another vehicle', async () => {
    const { legIds, vehicleIds } = await createSplit();

    const res = await ctx.authed('PUT', `/api/v1/expenses/${legIds[0]}`, {
      vehicleId: vehicleIds[2],
    });

    expect(res.status).toBe(400);
  });

  test('still accepts a description edit and an unchanged amount', async () => {
    const { legIds } = await createSplit();
    const legId = legIds[0] ?? '';

    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, {
      expenseAmount: 15,
      description: 'Front brakes',
    });

    expect(res.status, await res.text()).toBe(200);
    expect((await rowOf(legId))?.description).toBe('Front brakes');
  });
});

describe('DELETE /expenses/:id on a split leg', () => {
  test('rejects the delete and keeps every leg', async () => {
    const { legIds } = await createSplit();

    const res = await ctx.authed('DELETE', `/api/v1/expenses/${legIds[0]}`);

    expect(res.status).toBe(400);
    for (const id of legIds) expect(await rowOf(id)).not.toBeNull();
  });
});

describe('PUT /expenses/:id on a sourced expense', () => {
  test('rejects an amount or date change on an insurance term expense', async () => {
    const id = await createSourcedExpense('insurance_term');

    const amount = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    const date = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      date: '2024-07-01T00:00:00.000Z',
    });

    expect(amount.status).toBe(400);
    expect(date.status).toBe(400);
    expect((await rowOf(id))?.expense_amount).toBe(12000);
  });

  test('accepts description and tag edits on an insurance term expense', async () => {
    const id = await createSourcedExpense('insurance_term');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      description: 'Six-month premium',
      tags: ['insurance'],
    });

    expect(res.status, await res.text()).toBe(200);
    expect((await rowOf(id))?.description).toBe('Six-month premium');
  });

  test('leaves reminder expenses editable, since reminders never regenerate them', async () => {
    const id = await createSourcedExpense('reminder');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });

    expect(res.status, await res.text()).toBe(200);
    expect((await rowOf(id))?.expense_amount).toBe(9900);
  });
});
