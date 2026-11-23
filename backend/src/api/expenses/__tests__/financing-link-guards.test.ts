import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface Row {
  vehicle_id: string;
  source_type: string | null;
  source_id: string | null;
}

function rowOf(id: string): Row {
  return ctx.sqlite
    .query('SELECT vehicle_id, source_type, source_id FROM expenses WHERE id = ?')
    .get(id) as Row;
}

async function createFinancing(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'TestBank',
    originalAmount: 20000,
    termMonths: 60,
    startDate: '2024-01-01T00:00:00.000Z',
    paymentAmount: 400,
    apr: 5,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function createPayment(vehicleId: string, financingId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'financial',
    expenseAmount: 400,
    date: '2024-02-01T00:00:00.000Z',
    sourceType: 'financing',
    sourceId: financingId,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('moving a financing payment to another vehicle', () => {
  test('is rejected while it keeps the old vehicle financing link', async () => {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const corolla = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const financingId = await createFinancing(civic);
    const id = await createPayment(civic, financingId);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { vehicleId: corolla });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("linked to the current vehicle's financing");
    expect(rowOf(id)).toEqual({
      vehicle_id: civic,
      source_type: 'financing',
      source_id: financingId,
    });
  });

  test('works when the same request removes the link', async () => {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const corolla = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const id = await createPayment(civic, await createFinancing(civic));

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      vehicleId: corolla,
      sourceType: null,
      sourceId: null,
    });
    expect(res.status, await res.text()).toBe(200);
    expect(rowOf(id)).toEqual({ vehicle_id: corolla, source_type: null, source_id: null });
  });

  test("works when the same request links the new vehicle's financing", async () => {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const corolla = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const id = await createPayment(civic, await createFinancing(civic));
    const corollaFinancing = await createFinancing(corolla);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      vehicleId: corolla,
      sourceType: 'financing',
      sourceId: corollaFinancing,
    });
    expect(res.status, await res.text()).toBe(200);
    expect(rowOf(id)).toEqual({
      vehicle_id: corolla,
      source_type: 'financing',
      source_id: corollaFinancing,
    });
  });
});

describe('a split leg financing link', () => {
  async function linkedLeg(): Promise<{ legId: string; financingId: string }> {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const corolla = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const financingId = await createFinancing(civic);
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [civic, corolla] },
      category: 'financial',
      date: '2024-02-01',
      totalAmount: 30,
    });
    const body = await json<{ data: { siblings: Array<{ id: string; vehicleId: string }> } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const leg = body.data.siblings.find((s) => s.vehicleId === civic);
    if (!leg) throw new Error('no civic leg');
    ctx.sqlite
      .query("UPDATE expenses SET source_type = 'financing', source_id = ? WHERE id = ?")
      .run(financingId, leg.id);
    return { legId: leg.id, financingId };
  }

  test('cannot be removed from one leg', async () => {
    const { legId, financingId } = await linkedLeg();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, {
      sourceType: null,
      sourceId: null,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('financing link is set for the whole split');
    expect(rowOf(legId).source_id).toBe(financingId);
  });

  test('sending the unchanged link back is still allowed', async () => {
    const { legId, financingId } = await linkedLeg();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, {
      description: 'Shared loan payment',
      sourceType: 'financing',
      sourceId: financingId,
    });
    expect(res.status, await res.text()).toBe(200);
  });

  test('moving a linked leg gets the split message, not the move advice', async () => {
    const { legId } = await linkedLeg();
    const other = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2023 });
    const res = await ctx.authed('PUT', `/api/v1/expenses/${legId}`, { vehicleId: other });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('part of a split');
    expect(text).not.toContain('Remove the link');
  });
});

describe('a financing-linked split on a vehicle the caller cannot access', () => {
  test('answers 404 whatever the vehicle financing state', async () => {
    const owned = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const unfinanced = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const financingId = await createFinancing(owned);
    const outsider = await createInvitee(ctx, 'outsider');

    const attempts = [
      { vehicleId: owned, sourceId: financingId },
      { vehicleId: owned, sourceId: 'not-the-financing-id' },
      { vehicleId: unfinanced, sourceId: financingId },
    ];
    for (const { vehicleId, sourceId } of attempts) {
      const res = await outsider.request('POST', '/api/v1/expenses/split', {
        splitConfig: { method: 'even', vehicleIds: [vehicleId] },
        category: 'financial',
        date: '2024-02-01',
        totalAmount: 30,
        sourceType: 'financing',
        sourceId,
      });
      expect(res.status, await res.text()).toBe(404);
    }
  });
});

describe('moving with the old vehicle financing pair', () => {
  test('is rejected because the link does not match the new vehicle', async () => {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const corolla = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 });
    const financingId = await createFinancing(civic);
    const id = await createPayment(civic, financingId);
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      vehicleId: corolla,
      sourceType: 'financing',
      sourceId: financingId,
    });
    expect(res.status).toBe(400);
    expect(rowOf(id).vehicle_id).toBe(civic);
  });
});

describe('replaying a saved financing payment', () => {
  async function postPayment(vehicleId: string, financingId: string, clientId: string) {
    return ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 400,
      date: '2024-02-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: financingId,
      clientId,
    });
  }

  test('returns the saved row after the financing stops being active', async () => {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const financingId = await createFinancing(civic);
    const first = await json<DataEnvelope<{ id: string }>>(
      await postPayment(civic, financingId, 'replay-1')
    );
    ctx.sqlite.run('UPDATE vehicle_financing SET is_active = 0 WHERE id = ?', [financingId]);

    const res = await postPayment(civic, financingId, 'replay-1');
    const body = await json<DataEnvelope<{ id: string }>>(res);

    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.id).toBe(first.data.id);
    const count = ctx.sqlite
      .query("SELECT COUNT(*) AS n FROM expenses WHERE client_id = 'replay-1'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  test('a new clientId is still validated against the inactive financing', async () => {
    const civic = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const financingId = await createFinancing(civic);
    ctx.sqlite.run('UPDATE vehicle_financing SET is_active = 0 WHERE id = ?', [financingId]);

    const res = await postPayment(civic, financingId, 'fresh-1');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('no active financing');
  });
});
