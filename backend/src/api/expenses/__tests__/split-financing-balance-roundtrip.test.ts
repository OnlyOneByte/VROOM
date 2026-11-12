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

interface VehicleWithFinancing {
  id: string;
  financing?: { id: string; computedBalance?: number } | null;
}
interface SplitData {
  groupId: string;
  groupTotal: number;
}

async function seedFinancing(vehicleId: string, originalAmount: number): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'TestBank',
    originalAmount,
    termMonths: 60,
    startDate: '2024-01-01T00:00:00.000Z',
    paymentAmount: 400,
    apr: 5,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function getBalance(vehicleId: string): Promise<number> {
  const res = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}`);
  const body = await json<DataEnvelope<VehicleWithFinancing>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  const bal = body.data.financing?.computedBalance;
  expect(bal, 'vehicle response carries financing.computedBalance').toBeTypeOf('number');
  return bal as number;
}

describe('financing-sourced split expense balance round-trip', () => {
  test('a financing-sourced split REDUCES the displayed balance by the split total', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const financingId = await seedFinancing(vehicleId, 20000);

    expect(await getBalance(vehicleId)).toBe(20000);

    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'financial',
      totalAmount: 400,
      date: '2024-02-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: financingId,
    });
    const body = await json<DataEnvelope<SplitData>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    expect(await getBalance(vehicleId)).toBe(19600);
  });

  test('reallocating the split (PUT /split, same financed vehicle) keeps attribution correct', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const financingId = await seedFinancing(vehicleId, 20000);

    const createRes = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'financial',
      totalAmount: 400,
      date: '2024-02-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: financingId,
    });
    const created = await json<DataEnvelope<SplitData>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    expect(await getBalance(vehicleId)).toBe(19600);

    const putRes = await ctx.authed('PUT', `/api/v1/expenses/split/${created.data.groupId}`, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      totalAmount: 500,
    });
    expect(putRes.status, await putRes.clone().text()).toBe(200);

    expect(await getBalance(vehicleId)).toBe(19500);
  });

  test('a SOURCE-LESS split does NOT touch the financing balance', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await seedFinancing(vehicleId, 20000);

    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'misc',
      totalAmount: 400,
      date: '2024-02-01T00:00:00.000Z',
    });
    expect(res.status, await res.clone().text()).toBe(201);

    expect(await getBalance(vehicleId)).toBe(20000);
  });
});
