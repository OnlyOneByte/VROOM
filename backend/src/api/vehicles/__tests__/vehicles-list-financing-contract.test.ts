/**
 * Guards the enriched financing object on GET /vehicles. The list route injects computedBalance and
 * eligibleForPayoff, which the frontend depends on and the repository never stores. Without this
 * check, dropping the injection would silently break payoff math.
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

interface FinancingShape {
  id: string;
  vehicleId: string;
  financingType: string;
  provider: string;
  originalAmount: number;
  isActive?: boolean;
  computedBalance?: number;
  eligibleForPayoff?: boolean;
}
interface VehicleWithFinancing {
  id: string;
  financing?: FinancingShape;
}

/** Attaches a loan so the list route's enrichment branch runs. The path is doubled by the router mounts. */
async function seedLoan(vehicleId: string): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'Test Credit Union',
    originalAmount: 20000,
    apr: 5,
    termMonths: 60,
    startDate: '2024-01-01',
    paymentAmount: 380,
    paymentFrequency: 'monthly',
  });
  const body = await json<DataEnvelope<unknown>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
}

async function listVehicles(): Promise<VehicleWithFinancing[]> {
  const res = await ctx.authed('GET', '/api/v1/vehicles');
  const body = await json<DataEnvelope<VehicleWithFinancing[]>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

describe('GET /vehicles list: enriched financing contract', () => {
  test('a financed vehicle exposes the route-injected computed fields + the base financing row', async () => {
    const id = await seedVehicle(ctx, { nickname: 'Financed' });
    await seedLoan(id);

    const vehicles = await listVehicles();
    const v = vehicles.find((x) => x.id === id);
    expect(v, 'seeded vehicle should be in the list').toBeDefined();
    const financing = v?.financing;
    expect(financing, 'financed vehicle should carry a financing object').toBeDefined();
    if (!financing) throw new Error('unreachable');

    expect(Object.hasOwn(financing, 'computedBalance')).toBe(true);
    expect(typeof financing.computedBalance).toBe('number');
    expect(Object.hasOwn(financing, 'eligibleForPayoff')).toBe(true);
    expect(typeof financing.eligibleForPayoff).toBe('boolean');

    expect(financing.id).toBeDefined();
    expect(financing.vehicleId).toBe(id);
    expect(financing.financingType).toBe('loan');
    expect(financing.originalAmount).toBe(20000);
  });

  test('a fresh loan is not eligible for payoff (computedBalance tracks the real balance)', async () => {
    // Key presence alone would pass a hardcoded balance, so the value itself is asserted.
    const id = await seedVehicle(ctx, { nickname: 'FreshLoan' });
    await seedLoan(id);

    const financing = (await listVehicles()).find((x) => x.id === id)?.financing;
    if (!financing) throw new Error('expected financing on the seeded vehicle');
    expect(financing.computedBalance).toBeGreaterThan(0);
    expect(financing.eligibleForPayoff).toBe(false);
  });

  test('a vehicle with no financing simply omits the object (no phantom computed fields)', async () => {
    const id = await seedVehicle(ctx, { nickname: 'NoFinancing' });
    const v = (await listVehicles()).find((x) => x.id === id);
    expect(v).toBeDefined();
    expect(v?.financing).toBeUndefined();
  });

  test('a paid-off financing row still appears on the list, flagged isActive:false', async () => {
    // The join has no isActive filter. Consumers gate on isActive, so the paid-off row is ignored.
    // Filtering it out in the query would be a deliberate change that this test should catch.
    const id = await seedVehicle(ctx, { nickname: 'PaidOff' });
    await seedLoan(id);

    const beforeFin = (await listVehicles()).find((x) => x.id === id)?.financing;
    if (!beforeFin) throw new Error('expected financing on the seeded vehicle');
    const payoff = await ctx.authed('PUT', `/api/v1/financing/${beforeFin.id}/payoff`);
    expect(payoff.status, 'payoff should succeed').toBeLessThan(300);

    const after = (await listVehicles()).find((x) => x.id === id)?.financing;
    expect(after, 'a paid-off financing row is still returned on the list').toBeDefined();
    expect(after?.isActive).toBe(false);
    expect(after?.id).toBe(beforeFin.id);
  });
});
