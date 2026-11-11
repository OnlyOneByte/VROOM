import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const seedVehicle = (): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

interface HistoryRow {
  odometer: number;
  recordedAt: string;
  source: 'expense' | 'manual';
  sourceId: string;
  note: string | null;
}

async function createManualEntry(
  vehicleId: string,
  odometer: number,
  recordedAt: string
): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, { odometer, recordedAt });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

async function createFuelExpenseWithMileage(
  vehicleId: string,
  mileage: number,
  date: string
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'fuel',
    expenseAmount: 45,
    date,
    volume: 10,
    mileage,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('odometer GET /:vehicleId/history (route contract)', () => {
  test('merges manual entries and expense-mileage rows, newest first', async () => {
    const vehicleId = await seedVehicle();
    const expId = await createFuelExpenseWithMileage(vehicleId, 30_000, '2024-06-01T12:00:00.000Z');
    const manualId = await createManualEntry(vehicleId, 31_000, '2024-06-15T12:00:00.000Z');

    const res = await ctx.authed('GET', `/api/v1/odometer/${vehicleId}/history`);
    const body = await json<PaginatedEnvelope<HistoryRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    expect(body.pagination.totalCount).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].source).toBe('manual');
    expect(body.data[0].odometer).toBe(31_000);
    expect(body.data[0].sourceId).toBe(manualId);
    expect(body.data[1].source).toBe('expense');
    expect(body.data[1].odometer).toBe(30_000);
    expect(body.data[1].sourceId).toBe(expId);
  });

  test('an empty vehicle returns an empty history with a well-formed envelope', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('GET', `/api/v1/odometer/${vehicleId}/history`);
    expect(res.status).toBe(200);
    const body = await json<PaginatedEnvelope<HistoryRow>>(res);
    expect(body.data).toEqual([]);
    expect(body.pagination.totalCount).toBe(0);
    expect(body.pagination.hasMore).toBe(false);
  });

  test('limit truncates the page and flips hasMore', async () => {
    const vehicleId = await seedVehicle();
    await createManualEntry(vehicleId, 10_000, '2024-06-01T12:00:00.000Z');
    await createManualEntry(vehicleId, 11_000, '2024-06-02T12:00:00.000Z');
    await createManualEntry(vehicleId, 12_000, '2024-06-03T12:00:00.000Z');

    const res = await ctx.authed('GET', `/api/v1/odometer/${vehicleId}/history?limit=2&offset=0`);
    expect(res.status).toBe(200);
    const body = await json<PaginatedEnvelope<HistoryRow>>(res);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.totalCount).toBe(3);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.data[0].odometer).toBe(12_000);
  });

  test('history for an UNOWNED vehicle is 404 (ownership gate, no cross-tenant leak)', async () => {
    const res = await ctx.authed('GET', '/api/v1/odometer/does-not-exist/history');
    expect(res.status).toBe(404);
  });
});
