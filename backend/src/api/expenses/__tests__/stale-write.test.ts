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
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface Row {
  id: string;
  description: string | null;
  expenseAmount: number;
  updatedAt: string;
}

interface ErrorBody {
  error: { code: string; details?: { updatedAt: string | null } };
}

async function createExpense(): Promise<Row> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 40,
    date: '2024-06-01T00:00:00.000Z',
    description: 'Oil change',
  });
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<Row>>(res)).data;
}

const put = (id: string, body: object) => ctx.authed('PUT', `/api/v1/expenses/${id}`, body);

function stored(id: string): unknown {
  return ctx.sqlite.query('SELECT * FROM expenses WHERE id = ?').get(id);
}

describe('PUT /expenses/:id with expectedUpdatedAt', () => {
  test('a stale value is refused with 409 and nothing is written', async () => {
    const row = await createExpense();
    const fresh = await put(row.id, { description: 'Second', expectedUpdatedAt: row.updatedAt });
    expect(fresh.status).toBe(200);
    const current = (await json<DataEnvelope<Row>>(fresh)).data;
    const before = stored(row.id);

    const stale = await put(row.id, { description: 'Late', expectedUpdatedAt: row.updatedAt });
    expect(stale.status).toBe(409);
    const body = await json<ErrorBody>(stale);
    expect(body.error.code).toBe('EXPENSE_CHANGED');
    expect(body.error.details?.updatedAt).toBe(current.updatedAt);
    expect(stored(row.id)).toEqual(before);
  });

  test('a matching value saves', async () => {
    const row = await createExpense();
    const res = await put(row.id, { description: 'Matched', expectedUpdatedAt: row.updatedAt });
    expect(res.status).toBe(200);
    const saved = (await json<DataEnvelope<Row>>(res)).data;
    expect(saved.description).toBe('Matched');
    expect(saved.updatedAt).not.toBe(row.updatedAt);
  });

  test('no value saves as before, even after other writes', async () => {
    const row = await createExpense();
    await put(row.id, { description: 'First' });
    const res = await put(row.id, { description: 'Second' });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<Row>>(res)).data.description).toBe('Second');
  });

  test('two writes in the same second still leave the older value stale', async () => {
    const row = await createExpense();
    const first = await put(row.id, { description: 'A', expectedUpdatedAt: row.updatedAt });
    const afterFirst = (await json<DataEnvelope<Row>>(first)).data;
    const second = await put(row.id, { description: 'B', expectedUpdatedAt: afterFirst.updatedAt });
    expect(second.status).toBe(200);

    const late = await put(row.id, {
      description: 'Late',
      expectedUpdatedAt: afterFirst.updatedAt,
    });
    expect(late.status).toBe(409);
    expect(ctx.sqlite.query('SELECT description FROM expenses WHERE id = ?').get(row.id)).toEqual({
      description: 'B',
    });
  });

  test('a value that is not a date-time is a 400', async () => {
    const row = await createExpense();
    expect((await put(row.id, { description: 'x', expectedUpdatedAt: 'yesterday' })).status).toBe(
      400
    );
  });
});

describe('PUT /expenses/split/:id with expectedUpdatedAt', () => {
  async function createSplit(): Promise<{ groupId: string; updatedAt: string }> {
    const other = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId, other] },
      category: 'maintenance',
      date: '2024-02-01T00:00:00.000Z',
      totalAmount: 30,
    });
    expect(res.status).toBe(201);
    const body = await json<DataEnvelope<{ groupId: string; siblings: Row[] }>>(res);
    const latest =
      body.data.siblings
        .map((s) => s.updatedAt)
        .sort()
        .at(-1) ?? '';
    return { groupId: body.data.groupId, updatedAt: latest };
  }

  const splitPut = (groupId: string, body: object) =>
    ctx.authed('PUT', `/api/v1/expenses/split/${groupId}`, body);

  const legAmounts = (groupId: string) =>
    ctx.sqlite
      .query('SELECT expense_amount FROM expenses WHERE group_id = ? ORDER BY id')
      .all(groupId);

  test('a matching value saves and a stale one is refused with nothing written', async () => {
    const { groupId, updatedAt } = await createSplit();
    const splitConfig = { method: 'even', vehicleIds: [vehicleId] };
    const ok = await splitPut(groupId, {
      splitConfig,
      totalAmount: 50,
      expectedUpdatedAt: updatedAt,
    });
    expect(ok.status).toBe(200);
    const before = legAmounts(groupId);

    const stale = await splitPut(groupId, {
      splitConfig,
      totalAmount: 80,
      expectedUpdatedAt: updatedAt,
    });
    expect(stale.status).toBe(409);
    expect((await json<ErrorBody>(stale)).error.code).toBe('EXPENSE_CHANGED');
    expect(legAmounts(groupId)).toEqual(before);
  });

  test('no value saves as before', async () => {
    const { groupId } = await createSplit();
    const res = await splitPut(groupId, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      totalAmount: 50,
    });
    expect(res.status).toBe(200);
  });
});
