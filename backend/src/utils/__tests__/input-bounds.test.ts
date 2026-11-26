import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';
import { hasAtMostTwoDecimals } from '../money';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

function expenseBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    vehicleId,
    category: 'misc',
    expenseAmount: 10,
    date: '2024-02-01T12:00:00.000Z',
    ...overrides,
  };
}

function splitBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    splitConfig: { method: 'even', vehicleIds: [vehicleId] },
    category: 'misc',
    date: '2024-02-01',
    totalAmount: 30,
    ...overrides,
  };
}

function reminderBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'Inspection',
    type: 'notification',
    frequency: 'custom',
    intervalValue: 2,
    intervalUnit: 'year',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    ...overrides,
  };
}

async function status(method: string, path: string, body: unknown): Promise<number> {
  const res = await ctx.authed(method, path, body);
  await res.text();
  return res.status;
}

describe('hasAtMostTwoDecimals', () => {
  test('accepts whole and two-decimal amounts despite binary rounding', () => {
    for (const n of [1, 10.99, 0.1, 0.07, 12.34, 999_999.99, 0.1 + 0.2, 10_000_000.01, -4.2]) {
      expect(hasAtMostTwoDecimals(n), String(n)).toBe(true);
    }
  });

  test('accepts two-decimal amounts computed in floating point', () => {
    const tenCentsHundredTimes = Array.from({ length: 100 }, () => 0.1).reduce((a, b) => a + b);
    for (const n of [1234.56 - 1000.01, tenCentsHundredTimes, 19.99 * 3, 999_999.99 - 0.01]) {
      expect(hasAtMostTwoDecimals(n), String(n)).toBe(true);
    }
  });

  test('rejects sub-cent amounts, even within a millionth of a cent', () => {
    for (const n of [
      0.005, 10.999, 1.001, 1e-9, -1e-9, 1.999999999, 2.000000001, 1.0000001, 9_999_999.999, 5e-324,
    ]) {
      expect(hasAtMostTwoDecimals(n), String(n)).toBe(false);
    }
  });
});

describe('expense amounts', () => {
  test('accept up to 1,000,000 with two decimals', async () => {
    expect(
      await status('POST', '/api/v1/expenses', expenseBody({ expenseAmount: 1_000_000 }))
    ).toBe(201);
    expect(await status('POST', '/api/v1/expenses', expenseBody({ expenseAmount: 10.99 }))).toBe(
      201
    );
  });

  test.each([1_000_000.01, 1e13, 1e300, 0.005, 10.999, 1.999999999])(
    'reject %p on create',
    async (amount) => {
      expect(await status('POST', '/api/v1/expenses', expenseBody({ expenseAmount: amount }))).toBe(
        400
      );
    }
  );

  test('reject an out-of-range amount on update', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses', expenseBody({}));
    const created = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status).toBe(201);
    expect(
      await status('PUT', `/api/v1/expenses/${created.data.id}`, { expenseAmount: 1e13 })
    ).toBe(400);
  });

  test('reject an out-of-range split total or allocation', async () => {
    expect(
      await status('POST', '/api/v1/expenses/split', splitBody({ totalAmount: 1_000_001 }))
    ).toBe(400);
    expect(
      await status(
        'POST',
        '/api/v1/expenses/split',
        splitBody({
          totalAmount: 10.005,
          splitConfig: {
            method: 'absolute',
            allocations: [{ vehicleId, amount: 10.005 }],
          },
        })
      )
    ).toBe(400);
  });

  test('round-trip through CSV export and import at the maximum', async () => {
    expect(
      await status(
        'POST',
        '/api/v1/expenses',
        expenseBody({ expenseAmount: 1_000_000, mileage: 10_000_000 })
      )
    ).toBe(201);
    const csv = await (await ctx.authed('GET', '/api/v1/expenses/export')).text();
    ctx.sqlite.run('DELETE FROM expenses WHERE user_id = ?', [ctx.user.id]);

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<DataEnvelope<{ imported: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
  });

  test('bound the insurance costs and reminder amount that become expenses', async () => {
    const term = (costs: Record<string, unknown>) => ({
      company: 'Acme Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleId] },
          ...costs,
        },
      ],
    });
    expect(await status('POST', '/api/v1/insurance', term({ totalCost: 1200 }))).toBe(201);
    for (const costs of [
      { totalCost: 2_000_000 },
      { monthlyCost: 10.999 },
      { paymentAmount: 1_000_001 },
    ]) {
      expect(await status('POST', '/api/v1/insurance', term(costs)), JSON.stringify(costs)).toBe(
        400
      );
    }
    const expenseReminder = (expenseAmount: number) =>
      reminderBody({ type: 'expense', expenseCategory: 'maintenance', expenseAmount });
    expect(await status('POST', '/api/v1/reminders', expenseReminder(49.99))).toBe(201);
    expect(await status('POST', '/api/v1/reminders', expenseReminder(10.999))).toBe(400);
  });
});

describe('financing, vehicle, insurance and fill-up bounds', () => {
  const financing = (extra: Record<string, unknown>) => ({
    financingType: 'lease',
    provider: 'TestBank',
    originalAmount: 20000,
    termMonths: 36,
    startDate: '2024-01-01T00:00:00.000Z',
    paymentAmount: 400,
    ...extra,
  });
  const financingPath = () => `/api/v1/financing/vehicles/${vehicleId}/financing`;

  test.each([
    [{ originalAmount: 10_000_000, paymentAmount: 1_000_000 }, 201],
    [{ residualValue: 10_000_000, excessMileageFee: 1000, mileageLimit: 10_000_000 }, 201],
    [{ originalAmount: 10_000_000.01 }, 400],
    [{ originalAmount: 5_000_000.123 }, 400],
    [{ paymentAmount: 1_000_000.01 }, 400],
    [{ paymentAmount: 400.555 }, 400],
    [{ residualValue: 10_000_001 }, 400],
    [{ excessMileageFee: 1000.01 }, 400],
    [{ excessMileageFee: 0.255 }, 400],
    [{ mileageLimit: 9e15 }, 400],
  ])('financing %p gives %p', async (extra, expected) => {
    expect(await status('POST', financingPath(), financing(extra))).toBe(expected);
  });

  test('the payment-amount update has the same bound and a readable message', async () => {
    const res = await ctx.authed('POST', financingPath(), financing({}));
    const created = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status).toBe(201);
    const path = `/api/v1/financing/${created.data.id}/payment-amount`;
    const rejected = await ctx.authed('PATCH', path, { paymentAmount: 2_500_000.555 });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).toContain(
      'Payment amount must be 1,000,000 or less'
    );
    expect(await status('PATCH', path, { paymentAmount: 1_000_000 })).toBe(200);
  });

  test.each([
    [10_000_000, 200],
    [10_000_000.01, 400],
    [1e14, 400],
    [25_000.005, 400],
  ])('vehicle purchasePrice %p gives %p', async (purchasePrice, expected) => {
    expect(await status('PUT', `/api/v1/vehicles/${vehicleId}`, { purchasePrice })).toBe(expected);
  });

  const policy = (extra: Record<string, unknown>) => ({
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        vehicleCoverage: { vehicleIds: [vehicleId] },
        ...extra,
      },
    ],
  });

  test.each([
    [{ deductibleAmount: 1_000_000, coverageLimit: 100_000_000 }, 201],
    [{ deductibleAmount: 1_000_000.01 }, 400],
    [{ deductibleAmount: 500.555 }, 400],
    [{ coverageLimit: 100_000_000.01 }, 400],
    [{ coverageLimit: 1e14 }, 400],
  ])('insurance term %p gives %p', async (extra, expected) => {
    expect(await status('POST', '/api/v1/insurance', policy(extra))).toBe(expected);
  });

  test('a term update and a claim payout are bounded too', async () => {
    const res = await ctx.authed('POST', '/api/v1/insurance', policy({}));
    const created = await json<DataEnvelope<{ id: string; terms: Array<{ id: string }> }>>(res);
    expect(res.status, JSON.stringify(created)).toBe(201);
    const policyId = created.data.id;
    const termPath = `/api/v1/insurance/${policyId}/terms/${created.data.terms[0]?.id}`;
    expect(await status('PUT', termPath, { coverageLimit: 100_000_001 })).toBe(400);
    expect(await status('PUT', termPath, { deductibleAmount: 0.001 })).toBe(400);

    const claimsPath = `/api/v1/insurance/${policyId}/claims`;
    const claim = (payoutAmount: number) => ({
      claimDate: '2024-06-01T00:00:00.000Z',
      claimType: 'collision',
      payoutAmount,
    });
    expect(await status('POST', claimsPath, claim(10_000_000))).toBe(201);
    expect(await status('POST', claimsPath, claim(10_000_000.01))).toBe(400);
    expect(await status('POST', claimsPath, claim(1500.555))).toBe(400);
  });

  test('fill-up volume is capped at 1,000 in the API and the CSV import', async () => {
    const fillUp = (volume: number) =>
      expenseBody({ category: 'fuel', mileage: 1000, volume, fuelType: 'regular' });
    expect(await status('POST', '/api/v1/expenses', fillUp(1000))).toBe(201);
    expect(await status('POST', '/api/v1/expenses', fillUp(1000.01))).toBe(400);

    const csv = [
      'date,vehicle,category,amount,mileage,volume',
      '2024-06-01T00:00:00.000Z,2022 Toyota Camry,fuel,40,1200,1000',
      '2024-06-02T00:00:00.000Z,2022 Toyota Camry,fuel,40,1300,1001',
    ].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: true });
    const body =
      await json<DataEnvelope<{ rows: Array<{ status: string; message?: string }> }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.rows.map((r) => [r.status, r.message])).toEqual([
      ['ready', undefined],
      ['error', 'Volume must be 1,000 or less'],
    ]);
  });
});

describe('odometer readings', () => {
  test('accept up to 10,000,000 and reject more', async () => {
    const path = `/api/v1/odometer/${vehicleId}`;
    const reading = (odometer: number) => ({ odometer, recordedAt: '2024-02-01T12:00:00.000Z' });
    expect(await status('POST', path, reading(10_000_000))).toBe(201);
    expect(await status('POST', path, reading(10_000_001))).toBe(400);
    expect(await status('POST', path, reading(9e15))).toBe(400);
  });

  test('reject an out-of-range expense mileage, initial mileage or last service odometer', async () => {
    expect(await status('POST', '/api/v1/expenses', expenseBody({ mileage: 10_000_001 }))).toBe(
      400
    );
    expect(
      await status('PUT', `/api/v1/vehicles/${vehicleId}`, { initialMileage: 10_000_001 })
    ).toBe(400);
    expect(
      await status('POST', '/api/v1/reminders', reminderBody({ lastServiceOdometer: 10_000_001 }))
    ).toBe(400);
  });
});

describe('reminder intervals', () => {
  test.each([
    [100, 'year', 201],
    [101, 'year', 400],
    [1200, 'month', 201],
    [1201, 'month', 400],
    [1_000_000_000, 'year', 400],
  ] as const)('%p %s gives %p', async (intervalValue, intervalUnit, expected) => {
    expect(
      await status('POST', '/api/v1/reminders', reminderBody({ intervalValue, intervalUnit }))
    ).toBe(expected);
  });

  async function createReminder(): Promise<string> {
    const res = await ctx.authed('POST', '/api/v1/reminders', reminderBody({}));
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    return body.data.reminder.id;
  }

  test('an update that sends only the value is checked against the stored unit', async () => {
    const id = await createReminder();
    expect(await status('PUT', `/api/v1/reminders/${id}`, { intervalValue: 101 })).toBe(400);
    expect(await status('PUT', `/api/v1/reminders/${id}`, { intervalValue: 100 })).toBe(200);
  });

  test('an update that sends only the unit is checked against the stored value', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/reminders',
      reminderBody({ intervalValue: 1200, intervalUnit: 'month' })
    );
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const path = `/api/v1/reminders/${body.data.reminder.id}`;
    expect(await status('PUT', path, { intervalUnit: 'year' })).toBe(400);
    expect(await status('PUT', path, { intervalUnit: 'week' })).toBe(200);
  });

  test('a stored reminder already over the bounds can still be paused and renamed', async () => {
    const id = await createReminder();
    ctx.sqlite
      .query('UPDATE reminders SET interval_value = ?, last_service_odometer = ? WHERE id = ?')
      .run(1_000_000_000, 9e15, id);
    expect(await status('PUT', `/api/v1/reminders/${id}`, { isActive: false })).toBe(200);
    expect(await status('PUT', `/api/v1/reminders/${id}`, { name: 'Old reminder' })).toBe(200);
  });
});
