/**
 * Cross-type field reset on create-or-replace financing (C293 bug — the sibling defect to C240).
 *
 * `POST /api/v1/financing/vehicles/:vehicleId/financing` is a create-OR-REPLACE: when a vehicle
 * already has a financing row it REUSES that row via `financingRepository.update(...financingData,
 * isActive:true, endDate:null)` (routes.ts:156). The route's own comment frames it as "the vehicle's
 * financing is now THIS." But `update()` builds its SET clause from the supplied object and Drizzle
 * SKIPS `undefined` keys — and the cross-type fields are all `.optional()` in the create schema:
 *   - loan-only:  `apr`
 *   - lease-only: `residualValue`, `mileageLimit`, `excessMileageFee`
 *   - schedule:   `paymentDayOfMonth` / `paymentDayOfWeek`
 *
 * So converting a vehicle's financing TYPE (lease → loan, or loan → lease) leaves the PRIOR type's
 * fields STALE on the reused row. A lease with a `mileageLimit`/`excessMileageFee`, re-saved as a
 * loan that omits them, keeps those lease values — and the FE lease-metrics math
 * (`financing-calculations.ts:419-433`, which reads `mileageLimit`/`excessMileageFee`) and the
 * Google-Sheets export (which serializes all three lease columns) then surface a contradiction:
 * a `financingType:'loan'` record carrying a non-null annual mileage allowance. This violates
 * NORTH_STAR #2 (correct-for-everyone) — the create-or-replace promise must give the same clean
 * row a fresh `create()` would (absent optional fields default to NULL in the schema), not a merge
 * of old + new.
 *
 * The C240 guard (refinance-balance-reset) pinned the BALANCE reset on this same reuse path but not
 * the field reset. This drives the REAL POST route over createTestApp (which rewrites DATABASE_URL +
 * dynamic-imports the DB-bound modules) so it characterizes the actual HTTP behavior, then asserts
 * the stale-field invariant in BOTH directions.
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
  financingType: string;
  apr: number | null;
  residualValue: number | null;
  mileageLimit: number | null;
  excessMileageFee: number | null;
  paymentDayOfMonth: number | null;
}

async function createVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  return body.data.id;
}

async function postFinancing(
  vehicleId: string,
  payload: Record<string, unknown>
): Promise<FinancingShape> {
  const res = await ctx.authed(
    'POST',
    `/api/v1/financing/vehicles/${vehicleId}/financing`,
    payload
  );
  const body = await json<DataEnvelope<FinancingShape>>(res);
  return body.data;
}

describe('create-or-replace financing clears stale cross-type fields (C293)', () => {
  test('lease → loan: the prior lease fields (residualValue/mileageLimit/excessMileageFee) are cleared', async () => {
    const vehicleId = await createVehicle();

    // 1) A lease carrying all three lease-only fields.
    await postFinancing(vehicleId, {
      financingType: 'lease',
      provider: 'LeaseCo',
      originalAmount: 30000,
      termMonths: 36,
      startDate: '2024-01-01',
      paymentAmount: 400,
      residualValue: 18000,
      mileageLimit: 12000,
      excessMileageFee: 0.25,
    });

    // 2) Re-save the SAME vehicle as a LOAN that omits every lease field.
    const loan = await postFinancing(vehicleId, {
      financingType: 'loan',
      provider: 'LoanBank',
      originalAmount: 25000,
      apr: 5.9,
      termMonths: 60,
      startDate: '2024-06-01',
      paymentAmount: 480,
    });

    // The reused row must read as a clean loan — no lingering lease values.
    expect(loan.financingType).toBe('loan');
    expect(loan.apr).toBe(5.9);
    expect(loan.residualValue).toBeNull();
    expect(loan.mileageLimit).toBeNull();
    expect(loan.excessMileageFee).toBeNull();
  });

  test('loan → lease: the prior loan-only field (apr) is cleared', async () => {
    const vehicleId = await createVehicle();

    // 1) A loan with an APR.
    await postFinancing(vehicleId, {
      financingType: 'loan',
      provider: 'LoanBank',
      originalAmount: 25000,
      apr: 6.5,
      termMonths: 60,
      startDate: '2024-01-01',
      paymentAmount: 480,
    });

    // 2) Re-save as a LEASE that omits apr.
    const lease = await postFinancing(vehicleId, {
      financingType: 'lease',
      provider: 'LeaseCo',
      originalAmount: 30000,
      termMonths: 36,
      startDate: '2024-06-01',
      paymentAmount: 400,
      residualValue: 18000,
      mileageLimit: 12000,
      excessMileageFee: 0.25,
    });

    expect(lease.financingType).toBe('lease');
    expect(lease.apr).toBeNull();
    expect(lease.residualValue).toBe(18000);
    expect(lease.mileageLimit).toBe(12000);
  });
});
