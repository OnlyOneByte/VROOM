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

/** Seed a vehicle, returns its id. */
// This file's fixture is a nickname-required Honda Civic 2022; converge onto the shared test-helpers/seed
// seedVehicle (arch convergence, Angelo-approved) via a thin wrapper that keeps make/model/year explicit
// (the shared default is a Camry) so behavior is preserved.
const seedVehicle = (nickname: string): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2022, nickname });

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

/**
 * #67 (data-correctness, found C206) — re-financing a vehicle whose prior financing was paid off must
 * produce an ACTIVE record. The POST endpoint is a create-or-replace keyed on vehicleId; when a prior
 * row exists it reuses it via update(). `isActive` is .optional() in the create schema (a
 * .notNull().default(true) column → drizzle-zod omits it), and the FE financing payload never sends it,
 * so the update LEFT the prior isActive=false → the new active loan was silently dropped from
 * the isActive-filtered queries (loanBreakdown/analytics) + the FE's isActive gate. The fix re-activates (+ clears
 * endDate) on the upsert. These pin that contract over the real HTTP stack.
 */
describe('POST financing upsert — #67 re-activates a paid-off record', () => {
  test('re-financing a paid-off vehicle yields an ACTIVE record (the regression)', async () => {
    const id = await seedVehicle('Refinanced');
    await seedLoan(id);

    // Pay off the financing → isActive=false, endDate set. PUT /:financingId/payoff keys on the
    // financingId, so resolve it from the GET first.
    const seeded = (await getFinancing(id)).data;
    expect(seeded, 'seeded loan should be present').not.toBeNull();
    if (!seeded) throw new Error('unreachable');
    const payoff = await ctx.authed('PUT', `/api/v1/financing/${seeded.id}/payoff`);
    expect(payoff.status, 'payoff should succeed').toBeLessThan(300);

    // Confirm it really is inactive now (the precondition the bug needs).
    const paidOff = (await getFinancing(id)).data;
    expect(paidOff, 'financing row should still exist after payoff').not.toBeNull();
    expect(paidOff?.isActive).toBe(false);

    // Re-finance the SAME vehicle (a fresh lease) — the FE payload omits isActive, as the real form does.
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

    // The re-financed record MUST be active again (was the bug: stayed false).
    const after = (await getFinancing(id)).data;
    expect(after, 'refinanced vehicle should return a financing object').not.toBeNull();
    expect(after?.isActive).toBe(true);
    expect(after?.financingType).toBe('lease');
    expect(after?.originalAmount).toBe(25000);
  });

  test('updating an already-active financing keeps it active (idempotent, no regression)', async () => {
    const id = await seedVehicle('ActiveUpdate');
    await seedLoan(id);

    // Update some terms on the still-active loan (the normal edit path).
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
