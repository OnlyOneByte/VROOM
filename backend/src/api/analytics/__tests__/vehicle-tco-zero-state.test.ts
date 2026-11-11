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

interface VehicleTCO {
  totalCost: number;
  ownershipMonths: number;
  totalDistance: number;
  costPerDistance: number | null;
  costPerMonth: number;
}

const seedVehicle = (extra: Record<string, unknown> = {}): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2021, extra });

async function getTCO(vehicleId: string): Promise<VehicleTCO> {
  const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`);
  const body = await json<DataEnvelope<VehicleTCO>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

function expectAllFinite(tco: VehicleTCO): void {
  for (const [key, val] of Object.entries(tco)) {
    if (typeof val === 'number') {
      expect(Number.isFinite(val), `${key} must be finite, got ${val}`).toBe(true);
    }
  }
}

describe('vehicle TCO money math — zero/empty denominators stay finite', () => {
  test('a brand-new vehicle (no expenses, no purchaseDate, no mileage) yields finite, sane numbers', async () => {
    const vehicleId = await seedVehicle();
    const tco = await getTCO(vehicleId);

    expectAllFinite(tco);
    expect(tco.totalCost).toBe(0);
    expect(tco.totalDistance).toBe(0);
    expect(tco.costPerDistance).toBeNull();
    expect(tco.ownershipMonths).toBeGreaterThanOrEqual(1);
    expect(tco.costPerMonth).toBe(0);
  });

  test('an expense but still zero distance keeps costPerDistance null (no x/0 Infinity)', async () => {
    const vehicleId = await seedVehicle();
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
    expect(tco.costPerMonth).toBeGreaterThan(0);
  });

  test('a future purchaseDate does not produce a negative or non-finite cost-per-month', async () => {
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
