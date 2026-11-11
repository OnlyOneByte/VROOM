/**
 * Switching a vehicle's financing type through create-or-replace must not leave the previous type's
 * fields on the reused row. update() skips undefined keys and the cross-type fields are optional, so
 * each one must be reset to null explicitly. Drives the real POST route.
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

describe('create-or-replace financing clears stale cross-type fields', () => {
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
