/**
 * Characterizes GET /api/v1/analytics/vehicle-tco through the REAL stack
 * (route → analyticsRepository.getVehicleTCO → DB), focused on the division-heavy
 * money math at its most dangerous input: a BRAND-NEW vehicle (no expenses, no
 * purchaseDate, no mileage). cost-per-month divides by ownershipMonths and
 * cost-per-distance by totalDistance; the most common real state (just added a
 * car) is exactly where naive division yields Infinity / NaN / garbage.
 *
 * The math IS guarded today (ownershipMonths = Math.max(1, …); costPerDistance is
 * null when totalDistance is 0). This pins that contract so a refactor can't
 * silently reintroduce an Infinity/NaN reaching the analytics UI — the same class
 * as the cycle-3/4 infinite-radius chart bug.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static
 * imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface VehicleTCO {
  totalCost: number;
  ownershipMonths: number;
  totalDistance: number;
  costPerDistance: number | null;
  costPerMonth: number;
}

async function seedVehicle(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    ...extra,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function getTCO(vehicleId: string): Promise<VehicleTCO> {
  const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`);
  const body = await json<DataEnvelope<VehicleTCO>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

/** Guard the whole class: no number in the payload is NaN or ±Infinity. */
function expectAllFinite(tco: VehicleTCO): void {
  for (const [key, val] of Object.entries(tco)) {
    if (typeof val === 'number') {
      expect(Number.isFinite(val), `${key} must be finite, got ${val}`).toBe(true);
    }
  }
}

describe('vehicle TCO money math — zero/empty denominators stay finite', () => {
  test('a brand-new vehicle (no expenses, no purchaseDate, no mileage) yields finite, sane numbers', async () => {
    const vehicleId = await seedVehicle(); // no purchaseDate, no expenses
    const tco = await getTCO(vehicleId);

    expectAllFinite(tco);
    expect(tco.totalCost).toBe(0);
    expect(tco.totalDistance).toBe(0);
    // costPerDistance is NULL (not 0/0=NaN, not x/0=Infinity) when there's no distance.
    expect(tco.costPerDistance).toBeNull();
    // ownershipMonths is clamped to >= 1 so costPerMonth can't divide by zero.
    expect(tco.ownershipMonths).toBeGreaterThanOrEqual(1);
    expect(tco.costPerMonth).toBe(0); // 0 total / >=1 months
  });

  test('an expense but still zero distance keeps costPerDistance null (no x/0 Infinity)', async () => {
    const vehicleId = await seedVehicle();
    // A non-fuel expense with no mileage → totalCost > 0 but totalDistance still 0.
    const exp = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 200,
      date: '2024-06-01T00:00:00.000Z',
      description: 'New tires',
    });
    expect(exp.status).toBe(201);

    const tco = await getTCO(vehicleId);
    expectAllFinite(tco);
    expect(tco.totalCost).toBeGreaterThan(0);
    expect(tco.totalDistance).toBe(0);
    expect(tco.costPerDistance, 'cost/distance must stay null with zero distance').toBeNull();
    // costPerMonth = totalCost / max(1, monthsOwned) — finite and >= 0.
    expect(tco.costPerMonth).toBeGreaterThan(0);
  });

  test('a future purchaseDate does not produce a negative or non-finite cost-per-month', async () => {
    // A typo / pre-registration: purchaseDate in the future would make a naive
    // month-diff negative. The Math.max(1, …) clamp must keep costPerMonth sane.
    const vehicleId = await seedVehicle({
      purchaseDate: '2099-01-01T00:00:00.000Z',
      purchasePrice: 30000,
    });
    const tco = await getTCO(vehicleId);

    expectAllFinite(tco);
    expect(tco.ownershipMonths).toBeGreaterThanOrEqual(1);
    expect(tco.costPerMonth).toBeGreaterThanOrEqual(0);
  });
});
