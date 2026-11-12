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

    await postFinancing(vehicleId, {
      financingType: 'loan',
      provider: 'LoanBank',
      originalAmount: 25000,
      apr: 6.5,
      termMonths: 60,
      startDate: '2024-01-01',
      paymentAmount: 480,
    });

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
