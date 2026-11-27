import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
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

async function stored(id: string): Promise<unknown> {
  return await ctx.sql.get('SELECT * FROM expenses WHERE id = ?', [id]);
}

describe('PUT /expenses/:id with expectedUpdatedAt', () => {
  test('a stale value is refused with 409 and nothing is written', async () => {
    const row = await createExpense();
    const fresh = await put(row.id, { description: 'Second', expectedUpdatedAt: row.updatedAt });
    expect(fresh.status).toBe(200);
    const current = (await json<DataEnvelope<Row>>(fresh)).data;
    const before = await stored(row.id);

    const stale = await put(row.id, { description: 'Late', expectedUpdatedAt: row.updatedAt });
    expect(stale.status).toBe(409);
    const body = await json<ErrorBody>(stale);
    expect(body.error.code).toBe('EXPENSE_CHANGED');
    expect(body.error.details?.updatedAt).toBe(current.updatedAt);
    expect(await stored(row.id)).toEqual(before);
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
    expect(await ctx.sql.get('SELECT description FROM expenses WHERE id = ?', [row.id])).toEqual({
      description: 'B',
    });
  });

  test('clearing a financing link moves the version, so an edit read before it is refused', async () => {
    const row = await createExpense();
    await ctx.sql.run(
      "UPDATE expenses SET source_type = 'financing', source_id = 'loan-1' WHERE id = ?",
      [row.id]
    );

    expect(await repos().expenses.clearSource('financing', 'loan-1', ctx.user.id)).toBe(1);

    const stale = await put(row.id, { description: 'Late', expectedUpdatedAt: row.updatedAt });
    expect(stale.status).toBe(409);
    expect((await json<ErrorBody>(stale)).error.code).toBe('EXPENSE_CHANGED');
    expect(await ctx.sql.get('SELECT description FROM expenses WHERE id = ?', [row.id])).toEqual({
      description: 'Oil change',
    });
  });

  test('a currency change that rescales amounts moves the version, so an edit read before it is refused', async () => {
    const row = await createExpense();
    const changed = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'JPY' });
    expect(changed.status).toBe(200);

    const stale = await put(row.id, { description: 'Late', expectedUpdatedAt: row.updatedAt });
    expect(stale.status).toBe(409);
    expect((await json<ErrorBody>(stale)).error.code).toBe('EXPENSE_CHANGED');
  });

  test('a value that is not a date-time is a 400', async () => {
    const row = await createExpense();
    expect((await put(row.id, { description: 'x', expectedUpdatedAt: 'yesterday' })).status).toBe(
      400
    );
  });
});

describe('PUT /expenses/split/:id with expectedUpdatedAt', () => {
  async function createSplit(): Promise<{
    groupId: string;
    updatedAt: string;
    legIds: string[];
    other: string;
  }> {
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
    return {
      groupId: body.data.groupId,
      updatedAt: latest,
      legIds: body.data.siblings.map((s) => s.id),
      other,
    };
  }

  const latestLegTime = async (groupId: string): Promise<string> => {
    const row = (await ctx.sql.get('SELECT MAX(updated_at) AS t FROM expenses WHERE group_id = ?', [
      groupId,
    ])) as { t: number };
    return new Date(row.t * 1000).toISOString();
  };

  const splitPut = (groupId: string, body: object) =>
    ctx.authed('PUT', `/api/v1/expenses/split/${groupId}`, body);

  const legAmounts = async (groupId: string) =>
    await ctx.sql.all('SELECT expense_amount FROM expenses WHERE group_id = ? ORDER BY id', [
      groupId,
    ]);

  test('a matching value saves and a stale one is refused with nothing written', async () => {
    const { groupId, updatedAt } = await createSplit();
    const splitConfig = { method: 'even', vehicleIds: [vehicleId] };
    const ok = await splitPut(groupId, {
      splitConfig,
      totalAmount: 50,
      expectedUpdatedAt: updatedAt,
    });
    expect(ok.status).toBe(200);
    const before = await legAmounts(groupId);

    const stale = await splitPut(groupId, {
      splitConfig,
      totalAmount: 80,
      expectedUpdatedAt: updatedAt,
    });
    expect(stale.status).toBe(409);
    expect((await json<ErrorBody>(stale)).error.code).toBe('EXPENSE_CHANGED');
    expect(await legAmounts(groupId)).toEqual(before);
  });

  test('no value saves as before', async () => {
    const { groupId } = await createSplit();
    const res = await splitPut(groupId, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      totalAmount: 50,
    });
    expect(res.status).toBe(200);
  });

  test('editing two legs in the same second still moves the split version each time', async () => {
    const { groupId, legIds, other } = await createSplit();
    const [legA = '', legB = ''] = legIds;
    expect((await put(legA, { description: 'A' })).status).toBe(200);
    const afterA = await latestLegTime(groupId);
    expect((await put(legB, { description: 'B' })).status).toBe(200);
    expect((await latestLegTime(groupId)) > afterA).toBe(true);

    const stale = await splitPut(groupId, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId, other] },
      totalAmount: 40,
      expectedUpdatedAt: afterA,
    });
    expect(stale.status).toBe(409);
  });

  test('a split update that adds a leg gives every leg the new version', async () => {
    const { groupId, updatedAt, other } = await createSplit();
    const third = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2020 });
    const ok = await splitPut(groupId, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId, other, third] },
      totalAmount: 30,
      expectedUpdatedAt: updatedAt,
    });
    expect(ok.status).toBe(200);
    const legs = (await json<DataEnvelope<{ siblings: Row[] }>>(ok)).data.siblings;
    expect(legs).toHaveLength(3);
    expect(new Set(legs.map((leg) => leg.updatedAt)).size).toBe(1);
    expect(legs[0]?.updatedAt && legs[0].updatedAt > updatedAt).toBe(true);

    const stale = await splitPut(groupId, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      totalAmount: 30,
      expectedUpdatedAt: updatedAt,
    });
    expect(stale.status).toBe(409);
    expect(await legAmounts(groupId)).toHaveLength(3);
  });
});
