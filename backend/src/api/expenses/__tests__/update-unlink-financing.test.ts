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

interface SourceRow {
  source_type: string | null;
  source_id: string | null;
}

function sourceOf(id: string): SourceRow {
  return ctx.sqlite
    .query('SELECT source_type, source_id FROM expenses WHERE id = ?')
    .get(id) as SourceRow;
}

async function createLinkedPayment(): Promise<{ id: string; financingId: string }> {
  const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
  const finRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'TestBank',
    originalAmount: 20000,
    termMonths: 60,
    startDate: '2024-01-01T00:00:00.000Z',
    paymentAmount: 400,
    apr: 5,
  });
  const fin = await json<DataEnvelope<{ id: string }>>(finRes);
  expect(finRes.status, JSON.stringify(fin)).toBeLessThan(300);
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'financial',
    expenseAmount: 400,
    date: '2024-02-01T00:00:00.000Z',
    sourceType: 'financing',
    sourceId: fin.data.id,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { id: body.data.id, financingId: fin.data.id };
}

describe('PUT can remove a financing link', () => {
  test('sourceType:null with sourceId:null unlinks the payment', async () => {
    const { id } = await createLinkedPayment();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      category: 'misc',
      sourceType: null,
      sourceId: null,
    });
    expect(res.status, await res.text()).toBe(200);
    expect(sourceOf(id)).toEqual({ source_type: null, source_id: null });
  });

  test('omitting both keeps the link', async () => {
    const { id, financingId } = await createLinkedPayment();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 410 });
    expect(res.status, await res.text()).toBe(200);
    expect(sourceOf(id)).toEqual({ source_type: 'financing', source_id: financingId });
  });

  test.each([[{ sourceType: null }], [{ sourceId: null }], [{ sourceType: null, sourceId: 'x' }]])(
    'a half-cleared link %j is rejected',
    async (half) => {
      const { id, financingId } = await createLinkedPayment();
      const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, half);
      expect(res.status).toBe(400);
      expect(sourceOf(id)).toEqual({ source_type: 'financing', source_id: financingId });
    }
  );

  test('a reminder link cannot be removed this way', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-02-01T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    ctx.sqlite
      .query("UPDATE expenses SET source_type = 'reminder', source_id = 'r1' WHERE id = ?")
      .run(body.data.id);
    const put = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, {
      sourceType: null,
      sourceId: null,
    });
    expect(put.status).toBe(400);
    expect(sourceOf(body.data.id)).toEqual({ source_type: 'reminder', source_id: 'r1' });
  });
});
