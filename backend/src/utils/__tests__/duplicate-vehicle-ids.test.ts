import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';
import { DUPLICATE_VEHICLE_MESSAGE } from '../validation';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
});
afterEach(() => ctx.close());

function splitBody(splitConfig: unknown): unknown {
  return { splitConfig, category: 'misc', date: '2024-02-01', totalAmount: 30 };
}

const cases: [string, string, (id: string) => unknown][] = [
  [
    'an insurance term',
    '/api/v1/insurance',
    (id) => ({
      company: 'Acme Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [id, id] },
        },
      ],
    }),
  ],
  [
    'a reminder',
    '/api/v1/reminders',
    (id) => ({
      name: 'Rotate tires',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [id, id],
    }),
  ],
  [
    'an even split',
    '/api/v1/expenses/split',
    (id) => splitBody({ method: 'even', vehicleIds: [id, id] }),
  ],
  [
    'an absolute split',
    '/api/v1/expenses/split',
    (id) =>
      splitBody({
        method: 'absolute',
        allocations: [
          { vehicleId: id, amount: 10 },
          { vehicleId: id, amount: 20 },
        ],
      }),
  ],
  [
    'a percentage split',
    '/api/v1/expenses/split',
    (id) =>
      splitBody({
        method: 'percentage',
        allocations: [
          { vehicleId: id, percentage: 50 },
          { vehicleId: id, percentage: 50 },
        ],
      }),
  ],
];

describe('a vehicle listed twice', () => {
  for (const [label, route, body] of cases) {
    test(`is rejected with a 400 on ${label} and nothing is saved`, async () => {
      const res = await ctx.authed('POST', route, body(vehicleId));
      const text = await res.text();
      expect(res.status, text).toBe(400);
      expect(text).toContain(DUPLICATE_VEHICLE_MESSAGE);
      const saved = ctx.sqlite
        .query(
          'SELECT (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM reminders) + (SELECT COUNT(*) FROM insurance_policies) AS n'
        )
        .get() as { n: number };
      expect(saved.n).toBe(0);
    });
  }
});
