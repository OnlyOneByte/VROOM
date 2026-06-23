/**
 * GUARD (C4): end-to-end MONEY round-trip for a financing-sourced SPLIT expense.
 *
 * The existing financing-balance property test (financing/__tests__/financing-balance.property.test.ts)
 * drives `repo.computeBalance(...)` DIRECTLY at the repository layer. No test pinned the OBSERVABLE
 * round-trip: that a financing-sourced split expense created/edited through the REAL route stack
 * (POST/PUT /expenses/split → createSplitExpense → DB → GET /vehicles/:id balance-enrich) actually moves
 * the vehicle's DISPLAYED `computedBalance` (NORTH_STAR #1 — the headline loan figure the user sees).
 *
 * This is the layer the #147 fix (C2: re-validate the carried financing source on PUT /split) operates
 * on — but the #147 tests assert only the route STATUS (400 reject / 200 accept), never that a VALID
 * financing-sourced split's payment is correctly attributed to the loan and subtracted from the balance.
 * computeBalance sums `expenseAmount WHERE source_type='financing' AND source_id=<loan>` with NO vehicle
 * scope, and the split siblings carry that link, so this pins:
 *   - a financing-sourced split REDUCES the balance by exactly the split's total
 *   - reallocating it (PUT /split, same financed vehicle) keeps the attribution correct (no double-count,
 *     no orphaned payment) — the regenerated siblings still point at the loan
 *   - a SOURCE-LESS split does NOT touch the balance (no spurious attribution)
 *
 * Drives the real app over the in-memory DB (createTestApp); keep static imports type-only per the harness.
 */

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

/** Create active loan financing on the vehicle; return the financing id. */
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

/** Read the vehicle's currently-displayed financing computedBalance via GET /vehicles/:id. */
async function getBalance(vehicleId: string): Promise<number> {
  const res = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}`);
  const body = await json<DataEnvelope<VehicleWithFinancing>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  const bal = body.data.financing?.computedBalance;
  expect(bal, 'vehicle response carries financing.computedBalance').toBeTypeOf('number');
  return bal as number;
}

describe('financing-sourced split expense — balance round-trip (C4 guard, #147 purpose)', () => {
  test('a financing-sourced split REDUCES the displayed balance by the split total', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const financingId = await seedFinancing(vehicleId, 20000);

    // Fresh loan: balance == originalAmount (no payments yet).
    expect(await getBalance(vehicleId)).toBe(20000);

    // A financing-sourced split payment of 400 against this single vehicle.
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

    // The displayed balance dropped by exactly the payment (computeBalance summed the sibling).
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

    // Edit the split's total to 500 (same financed vehicle). The regenerated sibling still carries the
    // financing link (#147: re-validated against the new vehicle set, which is unchanged here), so the
    // balance reflects the NEW total — not a double-count (old + new) nor an orphaned old payment.
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

    // No source link → not summed into the loan → balance unchanged.
    expect(await getBalance(vehicleId)).toBe(20000);
  });
});
