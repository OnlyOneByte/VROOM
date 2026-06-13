/**
 * FE↔BE contract-drift guard for the GET /vehicles list response's enriched
 * `financing` object (loop-improvement #2; C55 locked /stats, this locks /vehicles).
 *
 * The list route hand-assembles each financed vehicle: it spreads the repository
 * financing row and INJECTS two computed fields the repository never stores --
 * `computedBalance` (from financingRepository.computeBalances) and `eligibleForPayoff`
 * (routes.ts:147-148). The frontend `VehicleFinancing` contract (vehicle.ts:65-66)
 * declares both, and the frontend reads `computedBalance` for payoff-date math, the
 * payment planner, lease metrics, and the financing form's payoff display.
 *
 * Nothing else pins that the route keeps emitting them: a refactor that returned
 * `findByUserId` rows verbatim would silently drop both, every consumer would fall back
 * to `?? 0`, and payoff logic would break with no failing test. This asserts the two
 * computed keys are present (and the base financing fields survive the spread), so the
 * drift fails loudly here instead.
 *
 * createTestApp() rewrites env + dynamic-imports the DB-bound modules, so this file
 * imports only the harness + bun:test.
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
  isActive?: boolean;
  computedBalance?: number;
  eligibleForPayoff?: boolean;
}
interface VehicleWithFinancing {
  id: string;
  financing?: FinancingShape;
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

/** Attach a loan to a vehicle so the list route's enrichment branch fires.
 *  The financing router mounts at /api/v1/financing and its handler path is
 *  /vehicles/:vehicleId/financing → the full endpoint is the doubled path below. */
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

describe('GET /vehicles list — enriched financing contract (FE↔BE drift guard)', () => {
  test('a financed vehicle exposes the route-injected computed fields + the base financing row', async () => {
    const id = await seedVehicle('Financed');
    await seedLoan(id);

    const vehicles = await listVehicles();
    const v = vehicles.find((x) => x.id === id);
    expect(v, 'seeded vehicle should be in the list').toBeDefined();
    const financing = v?.financing;
    expect(financing, 'financed vehicle should carry a financing object').toBeDefined();
    if (!financing) throw new Error('unreachable');

    // The two COMPUTED fields the route injects (the actual drift surface): present, typed.
    expect(Object.hasOwn(financing, 'computedBalance')).toBe(true);
    expect(typeof financing.computedBalance).toBe('number');
    expect(Object.hasOwn(financing, 'eligibleForPayoff')).toBe(true);
    expect(typeof financing.eligibleForPayoff).toBe('boolean');

    // Base financing fields survive the spread (the route does `...v.financing`).
    expect(financing.id).toBeDefined();
    expect(financing.vehicleId).toBe(id);
    expect(financing.financingType).toBe('loan');
    expect(financing.originalAmount).toBe(20000);
  });

  test('a fresh loan is NOT eligible for payoff (computedBalance tracks the real balance)', async () => {
    // Anchors the computed semantics, not just key presence: a brand-new 20k loan has a
    // positive balance, so eligibleForPayoff (balance <= 0.01) must be false. If the route
    // ever shipped a hardcoded/zeroed balance, this fails.
    const id = await seedVehicle('FreshLoan');
    await seedLoan(id);

    const financing = (await listVehicles()).find((x) => x.id === id)?.financing;
    if (!financing) throw new Error('expected financing on the seeded vehicle');
    expect(financing.computedBalance).toBeGreaterThan(0);
    expect(financing.eligibleForPayoff).toBe(false);
  });

  test('a vehicle with no financing simply omits the object (no phantom computed fields)', async () => {
    const id = await seedVehicle('NoFinancing');
    const v = (await listVehicles()).find((x) => x.id === id);
    expect(v).toBeDefined();
    expect(v?.financing).toBeUndefined();
  });

  test('a PAID-OFF (inactive) financing row STILL surfaces on the list, flagged isActive:false (C305 contract pin)', async () => {
    // findByUserId leftJoins vehicleFinancing with NO isActive filter, so a paid-off loan (isActive=false,
    // its row REUSED by the create-or-replace path per #67/C293, never deleted) still rides along on the
    // list — carrying isActive:false. This is BENIGN today: every FE financing consumer (FinanceTab,
    // VehicleForm, lease/payment math) gates on `financing?.isActive`, so a paid-off row is correctly
    // ignored. This pins that contract so the gate stays the source of truth — if a future BE change
    // started filtering inactive financing out of the join (or a consumer read vehicle.financing WITHOUT
    // the isActive gate), that's now a conscious, test-visible decision, not a silent drift. Asserts both:
    // (1) the row is still present, and (2) it's unambiguously marked isActive:false.
    const id = await seedVehicle('PaidOff');
    await seedLoan(id);

    // Pay it off via the financing payoff route → isActive=false on the SAME reused row.
    const beforeFin = (await listVehicles()).find((x) => x.id === id)?.financing;
    if (!beforeFin) throw new Error('expected financing on the seeded vehicle');
    const payoff = await ctx.authed('PUT', `/api/v1/financing/${beforeFin.id}/payoff`);
    expect(payoff.status, 'payoff should succeed').toBeLessThan(300);

    const after = (await listVehicles()).find((x) => x.id === id)?.financing;
    expect(
      after,
      'a paid-off financing row STILL rides along on the list (no isActive filter on the join)'
    ).toBeDefined();
    expect(after?.isActive).toBe(false);
    expect(after?.id).toBe(beforeFin.id); // the same reused row, now inactive
  });
});
