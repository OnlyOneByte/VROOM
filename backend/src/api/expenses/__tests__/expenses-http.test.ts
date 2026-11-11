import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

interface ExpenseRow {
  id: string;
  description: string;
  category: string;
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function createExpense(
  vehicleId: string,
  category: string,
  amount: number,
  description: string,
  date: string
) {
  const fuelFields = category === 'fuel' ? { volume: 10, mileage: 30_000 } : {};
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date,
    description,
    ...fuelFields,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('expenses HTTP search/pagination', () => {
  test('?search= matches description across the whole result set', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createExpense(
      vehicleId,
      'maintenance',
      75,
      'Jiffy Lube oil change',
      '2026-01-10T12:00:00.000Z'
    );
    await createExpense(vehicleId, 'fuel', 45, 'Chevron gas', '2026-01-15T12:00:00.000Z');
    await createExpense(vehicleId, 'misc', 8, 'Highway toll', '2026-01-18T12:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses?search=jiffy');
    expect(res.status).toBe(200);
    const body = await json<PaginatedEnvelope<ExpenseRow>>(res);
    expect(body.pagination.totalCount).toBe(1);
    expect(body.data[0].description).toBe('Jiffy Lube oil change');
  });

  test('?search= also matches category', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createExpense(vehicleId, 'maintenance', 75, 'oil', '2026-01-10T12:00:00.000Z');
    await createExpense(vehicleId, 'fuel', 45, 'gas', '2026-01-15T12:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses?search=mainten');
    const body = await json<PaginatedEnvelope<ExpenseRow>>(res);
    expect(body.pagination.totalCount).toBe(1);
    expect(body.data[0].category).toBe('maintenance');
  });

  test('limit/offset paginate the full set', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    for (let i = 0; i < 5; i++) {
      const day = String(10 + i).padStart(2, '0');
      await createExpense(vehicleId, 'misc', 1 + i, `row ${i}`, `2026-02-${day}T12:00:00.000Z`);
    }

    const page1 = await ctx.authed('GET', '/api/v1/expenses?limit=2&offset=0');
    const b1 = await json<PaginatedEnvelope<ExpenseRow>>(page1);
    expect(b1.data).toHaveLength(2);
    expect(b1.pagination.totalCount).toBe(5);

    const page2 = await ctx.authed('GET', '/api/v1/expenses?limit=2&offset=2');
    const b2 = await json<PaginatedEnvelope<ExpenseRow>>(page2);
    expect(b2.data).toHaveLength(2);
    expect(b2.data[0].id).not.toBe(b1.data[0].id);
  });

  test('search is user-scoped (no cross-user leakage via the route)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createExpense(vehicleId, 'misc', 5, 'unique-marker-xyz', '2026-01-10T12:00:00.000Z');

    const other = await createTestApp();
    try {
      const res = await other.authed('GET', '/api/v1/expenses?search=unique-marker-xyz');
      const body = await json<PaginatedEnvelope<ExpenseRow>>(res);
      expect(body.pagination.totalCount).toBe(0);
    } finally {
      other.close();
    }
  });
});

describe('PUT /api/v1/expenses/:id — vehicle reassignment ownership', () => {
  test('reassigning an expense to a foreign vehicle is rejected with 404', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const expenseId = await createExpense(
      vehicleId,
      'misc',
      12,
      'reassign me',
      '2026-03-01T12:00:00.000Z'
    );

    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('u-foreign-61', 'f61@test.com', 'Foreign')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-foreign-61', 'u-foreign-61', 'Mazda', '3', 2020)`
    );

    const res = await ctx.authed('PUT', `/api/v1/expenses/${expenseId}`, {
      vehicleId: 'veh-foreign-61',
    });
    expect(res.status).toBe(404);

    const getRes = await ctx.authed('GET', `/api/v1/expenses/${expenseId}`);
    const body = await json<DataEnvelope<{ vehicleId: string }>>(getRes);
    expect(body.data.vehicleId).toBe(vehicleId);
  });

  test('reassigning to the user’s own second vehicle still works', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const expenseId = await createExpense(v1, 'misc', 9, 'move to v2', '2026-03-02T12:00:00.000Z');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${expenseId}`, { vehicleId: v2 });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ vehicleId: string }>>(res);
    expect(body.data.vehicleId).toBe(v2);
  });

  test('a PUT that omits vehicleId still updates normally', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const expenseId = await createExpense(
      vehicleId,
      'misc',
      5,
      'before',
      '2026-03-03T12:00:00.000Z'
    );

    const res = await ctx.authed('PUT', `/api/v1/expenses/${expenseId}`, { description: 'after' });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ description: string; vehicleId: string }>>(res);
    expect(body.data.description).toBe('after');
    expect(body.data.vehicleId).toBe(vehicleId);
  });
});

describe('POST /api/v1/expenses — forceOverwrite keep-local resolution', () => {
  async function postExpense(body: Record<string, unknown>) {
    const res = await ctx.authed('POST', '/api/v1/expenses', body);
    return { res, body: await json<DataEnvelope<{ id: string; expenseAmount: number }>>(res) };
  }

  test('a collision WITH forceOverwrite applies the local edit in place (same id, new amount)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const clientId = 'c51-overwrite';
    const first = await postExpense({
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2026-04-01T12:00:00.000Z',
      description: 'orig',
      clientId,
    });
    expect(first.res.status, JSON.stringify(first.body)).toBe(201);

    const resolved = await postExpense({
      vehicleId,
      category: 'misc',
      expenseAmount: 88,
      date: '2026-04-01T12:00:00.000Z',
      description: 'resolved',
      clientId,
      forceOverwrite: true,
    });
    expect(resolved.res.status, JSON.stringify(resolved.body)).toBeLessThan(300);
    expect(resolved.body.data.id, 'same row updated in place').toBe(first.body.data.id);
    expect(resolved.body.data.expenseAmount, 'local edit applied').toBe(88);

    const list = await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`);
    const listBody = await json<PaginatedEnvelope<ExpenseRow>>(list);
    expect(listBody.data.length).toBe(1);
  });

  test('a collision WITHOUT forceOverwrite is the idempotent no-op (original amount kept)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const clientId = 'c51-noop';
    const first = await postExpense({
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2026-04-02T12:00:00.000Z',
      clientId,
    });
    expect(first.res.status).toBe(201);

    const retry = await postExpense({
      vehicleId,
      category: 'misc',
      expenseAmount: 999,
      date: '2026-04-02T12:00:00.000Z',
      clientId,
    });
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.expenseAmount, 'blind retry must NOT overwrite').toBe(10);
  });
});

describe('a keep-local overwrite that switches fuel→non-fuel clears the stale fuel fields', () => {
  test('overwriting a fuel row with a maintenance edit nulls volume/mileage/fuelType', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const clientId = 'c52-fuel-switch';

    const first = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 40,
      date: '2026-05-03T12:00:00.000Z',
      volume: 12,
      mileage: 41000,
      fuelType: '87 (Regular)',
      clientId,
    });
    const firstBody = await json<DataEnvelope<{ id: string; mileage: number | null }>>(first);
    expect(first.status, JSON.stringify(firstBody)).toBe(201);
    expect(firstBody.data.mileage).toBe(41000);

    const resolved = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 40,
      date: '2026-05-03T12:00:00.000Z',
      clientId,
      forceOverwrite: true,
    });
    const resolvedBody =
      await json<
        DataEnvelope<{
          id: string;
          category: string;
          volume: number | null;
          mileage: number | null;
          fuelType: string | null;
        }>
      >(resolved);
    expect(resolved.status, JSON.stringify(resolvedBody)).toBeLessThan(300);

    expect(resolvedBody.data.id).toBe(firstBody.data.id);
    expect(resolvedBody.data.category).toBe('maintenance');
    expect(resolvedBody.data.volume, 'stale volume nulled').toBeNull();
    expect(resolvedBody.data.mileage, 'stale mileage nulled').toBeNull();
    expect(resolvedBody.data.fuelType, 'stale fuelType nulled').toBeNull();
  });
});
