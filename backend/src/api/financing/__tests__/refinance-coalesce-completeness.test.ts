import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { vehicleFinancing } from '../../../db/schema';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

const OPTIONAL_FIELDS = [
  'apr',
  'paymentDayOfMonth',
  'paymentDayOfWeek',
  'residualValue',
  'mileageLimit',
  'excessMileageFee',
] as const;

const ROUTE_MANAGED = new Set(['endDate', 'isActive', 'createdAt', 'updatedAt']);

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface FinancingShape {
  id: string;
  financingType: string;
  [field: string]: unknown;
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

describe('create-or-replace coalesce-list completeness', () => {
  test('the optional-field list matches every nullable financing column the route does not manage', () => {
    const nullable = Object.entries(getTableColumns(vehicleFinancing))
      .filter(([, column]) => !column.notNull)
      .map(([name]) => name)
      .filter((name) => !ROUTE_MANAGED.has(name));

    expect(nullable.sort()).toEqual([...OPTIONAL_FIELDS].sort());
  });

  test('replacing a financing that set every optional field leaves none of them on the reused row', async () => {
    const vehicleId = await seedVehicle(ctx);

    const first = await postFinancing(vehicleId, {
      financingType: 'loan',
      provider: 'LoanBank',
      originalAmount: 25000,
      apr: 5.9,
      termMonths: 60,
      startDate: '2024-01-01',
      paymentAmount: 480,
      paymentDayOfMonth: 15,
      paymentDayOfWeek: 3,
      residualValue: 18000,
      mileageLimit: 12000,
      excessMileageFee: 0.25,
    });
    for (const field of OPTIONAL_FIELDS) {
      expect(first[field], `precondition: ${field} set on the first financing`).not.toBeNull();
    }

    const replacement = await postFinancing(vehicleId, {
      financingType: 'lease',
      provider: 'LeaseCo',
      originalAmount: 30000,
      termMonths: 36,
      startDate: '2024-06-01',
      paymentAmount: 400,
    });

    expect(replacement.id).toBe(first.id);
    for (const field of OPTIONAL_FIELDS) {
      expect(replacement[field], `${field} must be reset on replace`).toBeNull();
    }
  });
});
