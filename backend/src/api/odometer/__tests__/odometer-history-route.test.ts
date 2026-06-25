/**
 * In-process HTTP tests for the odometer HISTORY route (GET /api/v1/odometer/:vehicleId/history),
 * which had no route-level coverage — routes.ts:70-83 (the handler) was uncovered. The underlying
 * UNION-ALL repo method `getHistory` is unit-tested (odometer-history.property.test.ts), but that
 * property test drives the repository directly, so a regression in the ROUTE wiring (the ownership
 * gate, the pagination clamp, the buildPaginatedResponse envelope) wouldn't be caught. This drives
 * the REAL stack (route → validateVehicleOwnership → getHistory → buildPaginatedResponse) and pins:
 *   - the unified history merges BOTH sources (a manual odometer entry + an expense-mileage row),
 *     newest-first, with the per-row {odometer, source, sourceId, recordedAt} shape the FE reads;
 *   - the paginated envelope (totalCount / limit / offset / hasMore) is correct + hasMore flips
 *     when limit truncates the set;
 *   - an unowned vehicleId is a clean 404 (the ownership gate runs before any read), never a
 *     cross-tenant leak (the C109/#52 tenant discipline this route inherits).
 * (The repo's value-level correctness — MAX-by-value, userId-scope on both legs — is the property
 * test's job; this is the route contract.)
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to the
 * harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
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

interface PaginatedEnvelope<T> {
  success?: boolean;
  data: T[];
  pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
}

/** Create a manual odometer entry via the real POST route; returns its id. */
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

/** Create a fuel expense carrying a mileage reading via the real POST route; returns its id. */
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
    // Older: an expense-mileage reading. Newer: a manual odometer entry.
    const expId = await createFuelExpenseWithMileage(vehicleId, 30_000, '2024-06-01T12:00:00.000Z');
    const manualId = await createManualEntry(vehicleId, 31_000, '2024-06-15T12:00:00.000Z');

    const res = await ctx.authed('GET', `/api/v1/odometer/${vehicleId}/history`);
    const body = await json<PaginatedEnvelope<HistoryRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    expect(body.pagination.totalCount).toBe(2);
    expect(body.data).toHaveLength(2);
    // Ordered by recordedAt DESC → the manual (June 15) leads the expense (June 1).
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
    expect(body.pagination.hasMore).toBe(true); // offset(0) + data(2) < total(3)
    // Newest-first: the 12_000 (June 3) reading leads.
    expect(body.data[0].odometer).toBe(12_000);
  });

  test('history for an UNOWNED vehicle is 404 (ownership gate, no cross-tenant leak)', async () => {
    // A vehicleId that doesn't resolve to this user → validateVehicleOwnership throws NotFound.
    const res = await ctx.authed('GET', '/api/v1/odometer/does-not-exist/history');
    expect(res.status).toBe(404);
  });
});
