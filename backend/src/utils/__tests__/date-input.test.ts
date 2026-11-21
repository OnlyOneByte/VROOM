import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';
import { dateInput } from '../validation';

const BAD_DATES: unknown[] = [
  null,
  true,
  false,
  0,
  -1,
  '',
  'true',
  '0',
  '1800-01-01',
  '2999-01-01',
];

describe('dateInput', () => {
  test.each(BAD_DATES)('rejects %p', (value) => {
    expect(dateInput.safeParse(value).success).toBe(false);
  });

  test('accepts an ISO timestamp, a plain day and a positive epoch in milliseconds', () => {
    expect(dateInput.parse('2024-02-01T12:00:00.000Z').toISOString()).toBe(
      '2024-02-01T12:00:00.000Z'
    );
    expect(dateInput.parse('2024-02-01').toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(dateInput.parse(1_706_788_800_000).toISOString()).toBe('2024-02-01T12:00:00.000Z');
  });
});

describe('date fields reject values that would be saved as 1970', () => {
  let ctx: TestApp;
  let vehicleId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    vehicleId = await seedVehicle(ctx);
  });
  afterEach(() => ctx.close());

  const bodies: [string, string, (date: unknown, vehicleId: string) => unknown][] = [
    [
      'expense date',
      '/api/v1/expenses',
      (date, id) => ({ vehicleId: id, category: 'misc', expenseAmount: 10, date }),
    ],
    [
      'split expense date',
      '/api/v1/expenses/split',
      (date, id) => ({
        splitConfig: { method: 'even', vehicleIds: [id] },
        category: 'misc',
        totalAmount: 10,
        date,
      }),
    ],
    [
      'odometer recordedAt',
      '/api/v1/odometer/:vehicleId',
      (date) => ({ odometer: 100, recordedAt: date }),
    ],
    [
      'financing startDate',
      '/api/v1/financing/vehicles/:vehicleId/financing',
      (date) => ({
        financingType: 'loan',
        provider: 'TestBank',
        originalAmount: 20000,
        termMonths: 60,
        startDate: date,
        paymentAmount: 400,
        apr: 5,
      }),
    ],
  ];

  for (const [label, route, body] of bodies) {
    test(`${label} accepts a real date`, async () => {
      const res = await ctx.authed(
        'POST',
        route.replace(':vehicleId', vehicleId),
        body('2024-02-01T12:00:00.000Z', vehicleId)
      );
      expect(res.status, await res.text()).toBe(201);
    });

    test.each([null, true, 0])(`${label} rejects %p`, async (date) => {
      const res = await ctx.authed(
        'POST',
        route.replace(':vehicleId', vehicleId),
        body(date, vehicleId)
      );
      expect(res.status, await res.text()).toBe(400);
    });
  }
});
