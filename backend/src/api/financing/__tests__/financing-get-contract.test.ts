/**
 * FE↔BE contract-drift guard for the single-financing GET response's enriched shape
 * (loop-improvement #2; C55 locked /stats, C62 the /vehicles LIST enrichment — this locks the
 * single-financing GET, a SEPARATE hand-assembled surface).
 *
 * `GET /api/v1/financing/vehicles/:vehicleId/financing` runs `enrichWithBalance` (routes.ts:82),
 * which spreads the repository financing row and INJECTS two computed fields the repository never
 * stores — `computedBalance` (from `financingRepository.computeBalance`) and `eligibleForPayoff`.
 * This is the endpoint `FinanceTab` fetches directly, and the frontend `VehicleFinancing` contract
 * (vehicle.ts:65-66) declares both; the FE reads `computedBalance` for payoff-date math, the payment
 * planner, lease metrics, and the financing-form payoff display.
 *
 * Nothing else pins that THIS route keeps emitting them (the C62 guard covers only the list route):
 * a refactor of `enrichWithBalance` that returned the raw row would silently drop both here, every
 * consumer would fall back to `?? 0`, and payoff logic would break with no failing test. This asserts
 * the two computed keys are present (+ the base fields survive the spread) + the no-financing null
 * branch, so the drift fails loudly here instead.
 *
 * createTestApp() rewrites env + dynamic-imports the DB-bound modules, so this file imports only the
 * harness + bun:test.
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

interface FinancingShape {
  id: string;
  vehicleId: string;
  financingType: string;
  provider: string;
  originalAmount: number;
  computedBalance?: number;
  eligibleForPayoff?: boolean;
}

/** Seed a vehicle, returns its id. */
async function seedVehicle(nickname: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2022,
    nickname,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Attach a loan so the GET returns an enriched record. */
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

    // The two COMPUTED fields enrichWithBalance injects (the actual drift surface): present, typed.
    expect(Object.hasOwn(financing, 'computedBalance')).toBe(true);
    expect(typeof financing.computedBalance).toBe('number');
    expect(Object.hasOwn(financing, 'eligibleForPayoff')).toBe(true);
    expect(typeof financing.eligibleForPayoff).toBe('boolean');

    // Base financing fields survive the spread (`...financing`).
    expect(financing.id).toBeDefined();
    expect(financing.vehicleId).toBe(id);
    expect(financing.financingType).toBe('loan');
    expect(financing.originalAmount).toBe(20000);
  });

  test('a fresh loan is NOT eligible for payoff (computedBalance tracks the real balance)', async () => {
    // Anchors the computed SEMANTICS, not just key presence: a brand-new 20k loan has a positive
    // balance, so eligibleForPayoff (balance <= 0.01) must be false. A hardcoded/zeroed balance fails.
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
