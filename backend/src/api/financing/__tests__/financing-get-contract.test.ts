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

const seedVehicle = (nickname: string): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2022, nickname });

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

async function getFinancing(vehicleId: string): Promise<DataEnvelope<FinancingShape | null>> {
  const res = await ctx.authed('GET', `/api/v1/financing/vehicles/${vehicleId}/financing`);
  const body = await json<DataEnvelope<FinancingShape | null>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
}

describe('GET single financing — enriched contract (FE↔BE drift guard)', () => {
  test('a financed vehicle exposes the route-injected computed fields + the base financing row', async () => {
    const id = await seedVehicle('Financed');
    await seedLoan(id);

    const financing = (await getFinancing(id)).data;
    expect(financing, 'financed vehicle should return a financing object').not.toBeNull();
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

  test('a fresh loan is not eligible for payoff and its computedBalance is the real balance', async () => {
    const id = await seedVehicle('FreshLoan');
    await seedLoan(id);

    const financing = (await getFinancing(id)).data;
    if (!financing) throw new Error('expected financing on the seeded vehicle');
    expect(financing.computedBalance).toBeGreaterThan(0);
    expect(financing.eligibleForPayoff).toBe(false);
  });

  test('a vehicle with no financing returns data:null (no phantom enriched object)', async () => {
    const id = await seedVehicle('NoFinancing');
    const body = await getFinancing(id);
    expect(body.data).toBeNull();
  });
});

describe('POST financing upsert re-activates a paid-off record', () => {
  test('re-financing a paid-off vehicle yields an active record', async () => {
    const id = await seedVehicle('Refinanced');
    await seedLoan(id);

    const seeded = (await getFinancing(id)).data;
    expect(seeded, 'seeded loan should be present').not.toBeNull();
    if (!seeded) throw new Error('unreachable');
    const payoff = await ctx.authed('PUT', `/api/v1/financing/${seeded.id}/payoff`);
    expect(payoff.status, 'payoff should succeed').toBeLessThan(300);

    const paidOff = (await getFinancing(id)).data;
    expect(paidOff, 'financing row should still exist after payoff').not.toBeNull();
    expect(paidOff?.isActive).toBe(false);

    const refi = await ctx.authed('POST', `/api/v1/financing/vehicles/${id}/financing`, {
      financingType: 'lease',
      provider: 'New Leasing Co',
      originalAmount: 25000,
      termMonths: 36,
      startDate: '2025-01-01',
      paymentAmount: 350,
      paymentFrequency: 'monthly',
      mileageLimit: 12000,
      excessMileageFee: 0.25,
    });
    const refiBody = await json<DataEnvelope<FinancingShape>>(refi);
    expect(refi.status, JSON.stringify(refiBody)).toBeLessThan(300);

    const after = (await getFinancing(id)).data;
    expect(after, 'refinanced vehicle should return a financing object').not.toBeNull();
    expect(after?.isActive).toBe(true);
    expect(after?.financingType).toBe('lease');
    expect(after?.originalAmount).toBe(25000);
  });

  test('updating an already-active financing keeps it active', async () => {
    const id = await seedVehicle('ActiveUpdate');
    await seedLoan(id);

    const upd = await ctx.authed('POST', `/api/v1/financing/vehicles/${id}/financing`, {
      financingType: 'loan',
      provider: 'Test Credit Union',
      originalAmount: 22000,
      apr: 4.5,
      termMonths: 60,
      startDate: '2024-01-01',
      paymentAmount: 400,
      paymentFrequency: 'monthly',
    });
    const updBody = await json<DataEnvelope<FinancingShape>>(upd);
    expect(upd.status, JSON.stringify(updBody)).toBeLessThan(300);

    const after = (await getFinancing(id)).data;
    expect(after?.isActive).toBe(true);
    expect(after?.originalAmount).toBe(22000);
  });
});
